/**
 * tests/compliance/fix-p2-9-register-toolbar.test.ts
 *
 * Fix Phase 2.9. Owner, message 6, verbatim: "The register activity page
 * also, the top button bar, is cutoff. Can you fix it so everything is
 * visible on screen."
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("Fix Phase 2.9: Register Activity buttons wrap, none cut off", () => {
  it("AdminPageHeader has a full-width toolbar row that wraps", () => {
    const h = read("src/components/admin/AdminPageHeader.tsx");
    expect(h).toMatch(/toolbar\?: ReactNode;/);
    expect(h).toMatch(/<nav aria-label=\{`\$\{title\} links`\} className="flex flex-wrap/);
  });

  it("Register Activity puts its buttons in the toolbar, in the SOP's order", () => {
    const p = read("src/app/admin/registers/page.tsx");
    const start = p.indexOf("toolbar={");
    expect(start).toBeGreaterThan(0);
    const bar = p.slice(start, start + 6000);
    const order = [
      "/eod",
      "/cashiers",
      "/history",
      "/over-short",
      "/exceptions",
      "/returns",
      "/safe",
      "/deposit-bags",
      "/supply-runs",
      "/admin/staffing/tips",
      "/devices",
      "/receipt",
      "/rounding",
      "/scanning",
    ];
    let last = -1;
    for (const href of order) {
      const at = bar.indexOf(href);
      expect(at, href).toBeGreaterThan(last);
      last = at;
    }
  });

  it("no button sits in a non-wrapping action row any more", () => {
    const p = read("src/app/admin/registers/page.tsx");
    const head = p.slice(p.indexOf("<AdminPageHeader"), p.indexOf("toolbar={"));
    expect(head).not.toMatch(/action=\{/);
  });

  it("SOP-01 §4.37 and the KB describe it", () => {
    expect(read("docs/sop/SOP-01-register-operations.md")).toMatch(/### 4\.37 Register Activity buttons/);
    expect(read("src/lib/admin/concierge-kb.ts")).toMatch(/Register Activity buttons \(Phase 2\.9\)/);
    expect(read("docs/sop-program/06-FIX-PHASE-PLAN.md")).toMatch(/\| 2\.9 \| Register Activity button bar[^\n]*\*\*BUILT\*\*/);
  });
});
