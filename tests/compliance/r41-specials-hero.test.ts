/**
 * tests/compliance/r41-specials-hero.test.ts — R41 S4.
 *
 * Specials TOP hero buttons become editable (add / edit / remove / repoint),
 * plus Banner Studio designs for the hero and the Today's Deal banner. Locks:
 *  - default presentation JSON is unchanged (no R41 keys) → live page identical
 *  - legacy row buttons render until the owner saves buttons here
 *  - the classic hero markup is kept verbatim in the else-branch
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  defaultSpecialsPresentation,
  normalizeSpecialsPresentation,
  parseSpecialsPresentation,
  serializeSpecialsPresentation,
} from "@/lib/specials/specials-presentation-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("R41 S4 Specials hero", () => {
  it("default JSON carries no R41 keys", () => {
    const json = serializeSpecialsPresentation(defaultSpecialsPresentation());
    expect(json).not.toContain("heroButtons");
    expect(json).not.toContain("heroDesign");
    expect(json).not.toContain("todaysDealsDesign");
  });

  it("saved empty list = no buttons, and survives a round-trip", () => {
    const p = normalizeSpecialsPresentation({ heroButtonsSet: true, heroButtons: [] });
    const back = parseSpecialsPresentation(serializeSpecialsPresentation(p))!;
    expect(back.heroButtonsSet).toBe(true);
    expect(back.heroButtons).toEqual([]);
  });

  it("unsafe links are dropped", () => {
    const p = normalizeSpecialsPresentation({
      heroButtonsSet: true,
      heroButtons: [{ label: "x", href: "javascript:alert(1)" }, { label: "ok", href: "/menu" }],
    });
    expect(p.heroButtons.map((b) => b.href)).toEqual(["/menu"]);
  });

  it("public page prefers saved buttons, else the legacy row", () => {
    const src = read("src/app/(site)/specials/page.tsx");
    expect(src).toContain("buttons: presentation.heroButtonsSet ? presentation.heroButtons : hero?.buttons");
  });

  it("hero renders the design when enabled, classic hero kept verbatim otherwise", () => {
    const src = read("src/components/specials/SpecialsContent.tsx");
    expect(src).toContain("{pres.heroDesign?.enabled ? (");
    expect(src).toContain('owner="specials:hero"');
    expect(src).toContain("headingLevel={1}");
    // classic hero pinned strings still present
    expect(src).toContain('"data-gw-block": "specials.hero.title"');
    expect(src).toContain('{content?.title || "Cannabis Specials"}');
    expect(src).toContain("design={pres.todaysDealsDesign}");
  });

  it("Today's Deal banner forwards the design with its owner id", () => {
    const src = read("src/components/specials/SpecialsDailyDeals.tsx");
    expect(src).toContain("design={design}");
    expect(src).toContain('designOwner="specials:todays"');
  });

  it("editor exposes hero buttons + both design cards; pinned editor strings intact", () => {
    const src = read("src/components/admin/SpecialsPresentationEditor.tsx");
    expect(src).toContain("<HeroButtonsCard");
    expect(src).toContain('setGlobal("heroDesign", heroDesign)');
    expect(src).toContain('setGlobal("todaysDealsDesign", todaysDealsDesign)');
    expect(src).toContain('type TabKey = "hero" | "cards" | "banner";');
    expect(src).toContain('useState<TabKey>(props.initialTab ?? "hero")'); // R43: ?tab= deep link, still defaults to hero
    const panels = read("src/components/admin/specials/SpecialsR41Panels.tsx");
    expect(panels).toContain("<LinkPicker");
    expect(panels).toContain("disabled={list.length >= MAX_SPECIALS_HERO_BUTTONS}");
    expect(panels).toContain("Go back to the old buttons");
    expect(read("src/components/admin/banner-studio/BannerEditorShell.tsx")).toContain("ssr: false");
  });
});
