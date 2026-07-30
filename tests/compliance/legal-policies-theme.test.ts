/**
 * SLICE 110 — Legal Policies theme touch-up + Medical "no card" high-CBD redirect.
 *
 * Michael (touch-up list):
 *   (Legal Policies page) "too much white → match theme; Delete button
 *   inconsistent; top warning bar wrong color/style → match gold."
 *   (Medical page) the "no card, no problem" CTA should NOT be editable — it
 *   should point at "any and all high CBD products we sell on the menu"
 *   (WA chapter 246-70 WAC high-CBD), NOT the full unfiltered menu.
 *
 * This is a PRESENTATION + LINK-TARGET touch-up ONLY. It changes no server
 * logic, no content blocks, and no compliance surface. The SLICE 105b editor
 * behavior stays pinned by legal-policies-editor.test.ts; this file pins the
 * VISUAL/redirect deltas so a future refactor can't quietly regress them.
 *
 * Pins:
 *   - PolicyDocEditor is fully dark-themed: no white/amber/light-pill/light-red
 *     Tailwind classes remain (would look wrong on the dark admin surface),
 *   - the top caution bar is GOLD (matches the Loyalty/Medical editor pattern),
 *   - the per-row Delete control uses the shared <Button variant="danger">
 *     (consistent brand danger button, not an ad-hoc light-red button),
 *   - the row textarea + move/restore controls use admin theme tokens,
 *   - BOTH public Medical "no card" high-CBD links point at /menu?strains=cbd
 *     (never bare /menu), so they land on the CBD-filtered menu view,
 *   - the menu's high-CBD filter contract that makes ?strains=cbd meaningful is
 *     intact end-to-end (HIGH_CBD_VALUE="cbd" -> isHighCbdItem -> CBD >= 4%).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

const POLICY_EDITOR = "src/components/admin/PolicyDocEditor.tsx";
const MEDICAL = "src/components/medical/MedicalProgramContent.tsx";
const MENU_BROWSER = "src/components/menu/InteractiveMenuBrowser.tsx";
const MENU_PAGE = "src/app/menu/page.tsx";

describe("SLICE 110 — Legal Policies editor is fully dark-themed", () => {
  const src = read(POLICY_EDITOR);

  it("has no leftover white / light-surface / amber / light-red / light-pill classes", () => {
    // These would render as bright white boxes / amber bars on the dark admin
    // surface — exactly the "too much white" Michael flagged.
    const banned = [
      /bg-white\b/,
      /\bamber-\d/,
      /\bred-50\b/,
      /\bred-200\b/,
      /\bred-700\b/,
      /f3f4f6/,
      /\bbg-gray-\d/,
      /\borange-\d/,
      /\bgreen-\d{2,3}\b/,
    ];
    for (const re of banned) {
      expect(src, `banned class ${re} present in PolicyDocEditor`).not.toMatch(re);
    }
  });

  it("the top caution bar is GOLD (matches the Loyalty/Medical editor pattern)", () => {
    expect(src).toMatch(/border-2 border-\[var\(--admin-gold\)\]\/60/);
    expect(src).toMatch(/bg-\[var\(--admin-gold\)\]\/10/);
    // gold heading text on the bar
    expect(src).toMatch(/text-\[var\(--admin-gold\)\]/);
  });

  it("the Delete control uses the shared danger Button (consistent brand)", () => {
    expect(src).toMatch(/<Button\s+variant="danger"\s+size="sm"\s+type="button"/);
    expect(src).toMatch(/onClick=\{\(\) => removeRow\(row\.id\)\}/);
    expect(src).toMatch(/import \{ Button \} from "@\/components\/admin\/ui"/);
  });

  it("the row textarea uses dark admin surface tokens (not white)", () => {
    expect(src).toMatch(/bg-\[var\(--admin-surface-2\)\]/);
    expect(src).toMatch(/text-\[var\(--admin-text\)\]/);
    expect(src).toMatch(/placeholder:text-\[var\(--admin-text-faint\)\]/);
  });

  it("move + restore controls use the themed hover token (not the old light fallback)", () => {
    expect(src).not.toMatch(/hover:bg-\[var\(--admin-surface-2,#f3f4f6\)\]/);
    expect(src).toMatch(/hover:bg-\[var\(--admin-surface-hover\)\]/);
  });
});

describe("SLICE 110 — Medical 'no card' CTA lands on the high-CBD menu", () => {
  const src = read(MEDICAL);

  it("has NO bare /menu link (must always carry the CBD filter)", () => {
    // href="/menu" with a closing quote right after = bare menu. Reject it.
    expect(src).not.toMatch(/href="\/menu"/);
  });

  it("every /menu link points at the CBD-filtered view /menu?strains=cbd", () => {
    const matches = src.match(/href="\/menu[^"]*"/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const m of matches) {
      expect(m).toBe('href="/menu?strains=cbd"');
    }
  });
});

describe("SLICE 110 — the menu high-CBD filter that makes ?strains=cbd meaningful is intact", () => {
  const menu = read(MENU_BROWSER);
  const page = read(MENU_PAGE);

  it("the menu page reads the ?strains param", () => {
    expect(page).toMatch(/strains:\s*firstSearchParamValue\(resolvedSearchParams\?\.strains\)/);
  });

  it('HIGH_CBD_VALUE is "cbd" and drives the high-CBD item predicate', () => {
    expect(menu).toMatch(/const HIGH_CBD_VALUE = "cbd"/);
    expect(menu).toMatch(/const HIGH_CBD_THRESHOLD = 4/);
    // strain "cbd" -> isHighCbdItem
    expect(menu).toMatch(/if \(strain === HIGH_CBD_VALUE\) return isHighCbdItem\(item\)/);
    // isHighCbdItem = CBD percentage >= threshold
    expect(menu).toMatch(/return cbd !== null && cbd >= HIGH_CBD_THRESHOLD/);
  });

  it("the ?strains value is parsed into the selected-strains list", () => {
    expect(menu).toMatch(/const persistedStrains = parsePersistedList\(initialParams\.strains\)/);
    expect(menu).toMatch(/useState<string\[\]>\(persistedStrains\)/);
  });
});
