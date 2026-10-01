/**
 * tests/compliance/r19-quiet-accounting.test.tsx  (R19 · bible S19.18 fix A)
 *
 * Owner (verbatim): "the accounting issues need to be less loud, accounting
 * won't be fully built by the time we launch so I don't want it jumping to the
 * accounting tab every time an action happens. Maybe make the button
 * highlighted when there are issues, or glows brighter then duller than
 * brighter again".
 *
 * Proves: (1) no tab set auto-opens Accounting; (2) the attention cue renders
 * ONLY when set (Receiving stays byte-identical, pinned in page-tabs.test);
 * (3) the glow is WCAG 2.2.2 / 2.3.1 safe — finite iterations totalling < 5s,
 * ≤ 3 cycles per second, and no motion under prefers-reduced-motion;
 * (4) the refusal banner still survives the click onto Accounting.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PageTabs } from "@/components/admin/ui/PageTabs";
import { MANIFEST_PAGE_TABS } from "@/lib/admin/page-tab-sets";
import { booksNeedsAttention } from "@/lib/inventory/manifest-event-labels-core";
import type { TabSpec } from "@/lib/admin/page-tabs-core";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function render(tabs: readonly TabSpec<string>[], active: string, keep: Record<string, string | undefined> = {}) {
  return renderToStaticMarkup(
    <PageTabs base="/admin/inventory/intake/m1" tabs={tabs} active={active} ariaLabel="Manifest views" allow={[]} keep={keep} />,
  );
}
const withAttention = (on: boolean) =>
  MANIFEST_PAGE_TABS.map((t) => (t.key === "accounting" ? { ...t, attention: on } : t));

describe("R19 A1 · Accounting never auto-opens", () => {
  it("no manifest tab claims booksError / books as an auto-open param", () => {
    for (const t of MANIFEST_PAGE_TABS) {
      expect(t.autoOpenParams ?? []).not.toContain("booksError");
      expect(t.autoOpenParams ?? []).not.toContain("books");
    }
  });
  it("the actions still redirect to the manifest page WITHOUT forcing tab=accounting", () => {
    const actions = read("src/app/admin/inventory/intake/actions.ts");
    expect(actions).not.toContain("tab=accounting");
  });
});

describe("R19 A2 · the attention cue", () => {
  it("off → no data-attention, no glow class, no aria-label on a plain tab", () => {
    const html = render(withAttention(false), "delivery");
    expect(html).not.toContain("data-attention");
    expect(html).not.toContain("gw-tab-attention");
    expect(html).not.toContain("needs attention");
  });
  it("on → exactly one tab glows, with a text cue for screen readers", () => {
    const html = render(withAttention(true), "delivery");
    expect(html.match(/data-attention="true"/g)).toHaveLength(1);
    expect(html.match(/gw-tab-attention/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Accounting, needs attention"');
    // The cue sits on the Accounting link, not on Delivery.
    const acc = html.slice(html.indexOf("tab=accounting") - 400, html.indexOf("tab=accounting"));
    expect(acc).toContain("gw-tab-attention");
  });
  it("on + a count → the count pill and the cue together", () => {
    const tabs = MANIFEST_PAGE_TABS.map((t) =>
      t.key === "accounting" ? { ...t, attention: true, count: 2, countTone: "neutral" as const } : t,
    );
    const html = render(tabs, "delivery");
    expect(html).toContain('aria-label="Accounting, 2 items, needs attention"');
    expect(html).toContain('data-testid="page-tab-count"');
  });
  it("once the owner is ON the Accounting tab the glow stops (the active style wins)", () => {
    const html = render(withAttention(true), "accounting");
    expect(html).not.toContain("gw-tab-attention");
    expect(html).not.toContain("data-attention");
    expect(html).toContain('aria-current="page"');
  });
  it("the Accounting link carries booksError/books so the banner is still there; other tabs drop them", () => {
    const html = render(withAttention(true), "delivery", { booksError: "no category", books: "BILL_OK" });
    expect(html).toContain('href="/admin/inventory/intake/m1?tab=accounting&amp;booksError=no+category&amp;books=BILL_OK"');
    expect(html).toContain('href="/admin/inventory/intake/m1?tab=delivery"');
    expect(html).toContain('href="/admin/inventory/intake/m1?tab=issues"');
  });
  it("booksNeedsAttention drives the page", () => {
    expect(booksNeedsAttention(0, undefined)).toBe(false);
    expect(booksNeedsAttention(1, undefined)).toBe(true);
    expect(booksNeedsAttention(0, "x")).toBe(true);
  });
});

describe("R19 A3 · the glow is WCAG-safe", () => {
  const css = read("src/app/globals.css");
  const block = css.slice(css.indexOf("@keyframes gw-tab-attention-glow"), css.indexOf("SLICE 105"));
  it("runs a FINITE number of slow cycles totalling under 5 seconds (WCAG 2.2.2)", () => {
    const m = block.match(/\.gw-tab-attention\s*\{[^}]*animation:\s*gw-tab-attention-glow\s+([\d.]+)s\s+[\w-]+\s+(\d+);/);
    expect(m).not.toBeNull();
    const seconds = Number(m![1]);
    const cycles = Number(m![2]);
    expect(seconds * cycles).toBeLessThan(5);
    expect(1 / seconds).toBeLessThanOrEqual(3); // WCAG 2.3.1: ≤ 3 flashes per second
    expect(block).not.toMatch(/\.gw-tab-attention\s*\{[^}]*infinite/);
  });
  it("rests on a STATIC ring after the glow (so the highlight stays without motion)", () => {
    expect(block).toMatch(/\.gw-tab-attention\s*\{[^}]*box-shadow:/);
    expect(block).toMatch(/\.gw-tab-attention\s*\{[^}]*background-color:/);
  });
  it("no motion at all under prefers-reduced-motion", () => {
    expect(block).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.gw-tab-attention\s*\{\s*animation:\s*none;/);
  });
});
