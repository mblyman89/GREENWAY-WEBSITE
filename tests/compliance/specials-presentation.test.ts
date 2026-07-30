/**
 * SLICE 106 — Specials presentation editor (Website → Specials).
 *
 * Michael: give the Specials page real presentation controls (which weekday
 * deal cards show, their order, the badge style, optional copy overrides, and
 * the two section toggles) — WITHOUT touching the discount math. Prices and
 * offers still come from the promotions engine (Admin → Promotions).
 *
 * Pins:
 *   - specials-presentation-core pure logic (defaults, normalize, serialize,
 *     parse, resolve, ordering, hidden-by-presentation) via its self-tests +
 *     targeted cases,
 *   - the new "richjson" content block seed is LIVE-LOOK-SAFE: it resolves to
 *     the default that shows all 7 days in natural Mon→Sun order, both sections
 *     on, classic badge (so /specials is byte-identical until edited),
 *   - the render path can never blank the grid (bad/empty JSON -> default),
 *   - the "richjson" field type + editor page + actions + nav are wired,
 *   - /specials consumes the presentation and SpecialsContent restyles the
 *     chip ONLY (classic reproduces the shipped chip exactly),
 *   - the promotions dashboard surfaces "where this shows up" + a
 *     hidden-by-presentation heads-up, and NONE of this touches pricing.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CONTENT_BLOCK_SEEDS } from "@/lib/cms/content-blocks-seed";
import {
  SPECIALS_WEEKDAYS,
  BADGE_STYLES,
  isBadgeStyle,
  defaultSpecialsPresentation,
  normalizeSpecialsPresentation,
  serializeSpecialsPresentation,
  parseSpecialsPresentation,
  resolveSpecialsPresentation,
  orderedVisibleWeekdays,
  dayPresentationFor,
  isWeekdayHiddenByPresentation,
  __runSpecialsPresentationCoreTests,
} from "@/lib/specials/specials-presentation-core";

const read = (p: string) => readFileSync(p, "utf8");
const PRES_BLOCK = "specials.deals.presentation";

describe("specials-presentation-core", () => {
  it("passes its full self-test suite", () => {
    const { passed } = __runSpecialsPresentationCoreTests();
    expect(passed).toBeGreaterThan(20);
  });

  it("weekday + badge-style constants are the expected values", () => {
    expect([...SPECIALS_WEEKDAYS]).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    expect([...BADGE_STYLES]).toEqual(["classic", "bold", "minimal"]);
    expect(isBadgeStyle("classic")).toBe(true);
    expect(isBadgeStyle("neon")).toBe(false);
    expect(isBadgeStyle(42)).toBe(false);
  });

  it("default is LIVE-LOOK-SAFE (all 7 days visible, natural order, both sections on, classic)", () => {
    const def = defaultSpecialsPresentation();
    expect(def.showWeeklyGrid).toBe(true);
    expect(def.showTodaysDeals).toBe(true);
    expect(def.badgeStyle).toBe("classic");
    expect(def.days.map((d) => d.weekday)).toEqual([...SPECIALS_WEEKDAYS]);
    expect(def.days.every((d) => d.visible)).toBe(true);
    // natural Mon→Sun order out of orderedVisibleWeekdays
    expect(orderedVisibleWeekdays(def)).toEqual([...SPECIALS_WEEKDAYS]);
  });

  it("serialize -> parse round-trips; parse rejects bad/empty input", () => {
    const def = defaultSpecialsPresentation();
    const json = serializeSpecialsPresentation(def);
    const back = parseSpecialsPresentation(json);
    expect(back).not.toBeNull();
    expect(serializeSpecialsPresentation(back!)).toBe(json);
    expect(parseSpecialsPresentation("not json")).toBeNull();
    expect(parseSpecialsPresentation("")).toBeNull();
    expect(parseSpecialsPresentation("   ")).toBeNull();
  });

  it("resolve never returns null (bad/empty/null -> default)", () => {
    const def = serializeSpecialsPresentation(defaultSpecialsPresentation());
    expect(serializeSpecialsPresentation(resolveSpecialsPresentation(null))).toBe(def);
    expect(serializeSpecialsPresentation(resolveSpecialsPresentation(""))).toBe(def);
    expect(serializeSpecialsPresentation(resolveSpecialsPresentation("garbage"))).toBe(def);
    expect(serializeSpecialsPresentation(resolveSpecialsPresentation("[]"))).toBe(def);
  });

  it("normalize drops unknown weekdays and fills missing days visible in natural order", () => {
    const norm = normalizeSpecialsPresentation({
      showWeeklyGrid: true,
      showTodaysDeals: true,
      badgeStyle: "classic",
      days: [
        { weekday: "Nonesday", visible: false, order: 0 },
        { weekday: "Friday", visible: false, order: 0 },
      ],
    });
    // every real weekday present exactly once, no bogus ones
    expect(norm.days.map((d) => d.weekday).sort()).toEqual([...SPECIALS_WEEKDAYS].sort());
    // Friday preserved as hidden; others defaulted visible
    expect(dayPresentationFor(norm, "Friday")!.visible).toBe(false);
    expect(dayPresentationFor(norm, "Monday")!.visible).toBe(true);
  });

  it("orderedVisibleWeekdays filters hidden days and honors custom order", () => {
    const p = normalizeSpecialsPresentation({
      showWeeklyGrid: true,
      showTodaysDeals: true,
      badgeStyle: "classic",
      days: [
        { weekday: "Monday", visible: false, order: 0 },
        { weekday: "Sunday", visible: true, order: 1 },
        { weekday: "Tuesday", visible: true, order: 2 },
      ],
    });
    const order = orderedVisibleWeekdays(p);
    expect(order).not.toContain("Monday"); // hidden
    // Sunday (order 1) comes before Tuesday (order 2)
    expect(order.indexOf("Sunday")).toBeLessThan(order.indexOf("Tuesday"));
  });

  it("isWeekdayHiddenByPresentation: grid off hides all; per-day invisible hides one", () => {
    const gridOff = normalizeSpecialsPresentation({ showWeeklyGrid: false });
    expect(isWeekdayHiddenByPresentation(gridOff, "Monday")).toBe(true);

    const def = defaultSpecialsPresentation();
    expect(isWeekdayHiddenByPresentation(def, "Monday")).toBe(false);

    const hideThu = normalizeSpecialsPresentation({
      showWeeklyGrid: true,
      days: [{ weekday: "Thursday", visible: false, order: 0 }],
    });
    expect(isWeekdayHiddenByPresentation(hideThu, "Thursday")).toBe(true);
    expect(isWeekdayHiddenByPresentation(hideThu, "Monday")).toBe(false);
  });
});

describe("seed block is present and live-look-safe", () => {
  it("seeds one richjson block that resolves to the exact default", () => {
    const seed = CONTENT_BLOCK_SEEDS.find((s) => s.block_key === PRES_BLOCK);
    expect(seed).toBeTruthy();
    expect(seed!.field_type).toBe("richjson");
    expect(seed!.page).toBe("specials");
    expect(seed!.section).toBe("deals");
    // default value resolves to the live-look-safe default
    const resolved = resolveSpecialsPresentation(seed!.defaultValue);
    const def = defaultSpecialsPresentation();
    expect(serializeSpecialsPresentation(resolved)).toBe(serializeSpecialsPresentation(def));
    // all 7 days visible in natural order (the shipped look)
    expect(orderedVisibleWeekdays(resolved)).toEqual([...SPECIALS_WEEKDAYS]);
  });
});

describe("field type + pure runner wiring", () => {
  it('types.ts adds the "richjson" field type', () => {
    expect(read("src/lib/cms/types.ts")).toContain('"richjson"');
  });
  it("pure runner registers specials-presentation-core", () => {
    expect(read("scripts/compliance/run-pure-selftests.ts")).toContain(
      "__runSpecialsPresentationCoreTests",
    );
  });
});

describe("public /specials consumes the presentation (byte-identical until edited)", () => {
  it("page.tsx loads the block and passes presentation to SpecialsContent", () => {
    const src = read("src/app/specials/page.tsx");
    expect(src).toContain("specials.deals.presentation");
    expect(src).toContain("resolveSpecialsPresentation");
    expect(src).toContain("presentation={presentation}");
  });

  it("SpecialsContent restyles the chip ONLY; classic reproduces the shipped chip", () => {
    const src = read("src/components/specials/SpecialsContent.tsx");
    expect(src).toContain("offerChipClass");
    expect(src).toContain("orderedVisibleWeekdays");
    expect(src).toContain("dayPresentationFor");
    // section gates
    expect(src).toContain("pres.showWeeklyGrid");
    expect(src).toContain("pres.showTodaysDeals");
    // classic chip keeps the exact shipped classes (live-look-safe)
    expect(src).toContain("border border-[var(--orange)]/60 bg-black/55 text-[var(--orange)]");
    // NEVER touches pricing: no percentage math introduced here
    expect(src).not.toContain("menuCardDiscountForItem");
  });
});

describe("Specials editor + actions + nav", () => {
  it("editor page is gated, seeds lazily, builds engine copy, renders the editor", () => {
    const src = read("src/app/admin/specials/page.tsx");
    expect(src).toContain('requirePermission("content.edit")');
    expect(src).toContain("ensureContentBlocksSeeded");
    expect(src).toContain("weeklyDealSummaries");
    expect(src).toContain("loadPublishedRuleSnapshots");
    expect(src).toContain("SpecialsPresentationEditor");
  });

  it("editor component is a client editor with toggles/order/badge + a NOT-the-prices caution", () => {
    const src = read("src/components/admin/SpecialsPresentationEditor.tsx");
    expect(src).toContain('"use client"');
    expect(src).toContain("serializeSpecialsPresentation");
    expect(src).toContain("normalizeSpecialsPresentation");
    expect(src).toContain("orderedVisibleWeekdays");
    // caution + deep links to the one true engine
    expect(src).toContain("not the prices");
    expect(src).toContain("/admin/promotions");
    expect(src).toContain("Publish");
  });

  it("actions reuse the content-block store and revalidate /specials", () => {
    const src = read("src/app/admin/specials/actions.ts");
    expect(src).toContain("saveContentDraft");
    expect(src).toContain("publishContentBlock");
    expect(src).toContain("restoreContentRevisionToDraft");
    expect(src).toContain('revalidatePath("/specials")');
    expect(src).toContain(PRES_BLOCK);
  });

  it("nav has the Specials item pointing at the dedicated editor under Website", () => {
    const src = read("src/components/admin/admin-nav-data.ts");
    expect(src).toContain('href: "/admin/specials"');
    expect(src).toContain('label: "Specials"');
  });
});

describe("promotions dashboard surfaces presentation (without touching pricing)", () => {
  it('shows "where this shows up" + a hidden-by-presentation heads-up', () => {
    const src = read("src/app/admin/promotions/page.tsx");
    expect(src).toContain("resolveSpecialsPresentation");
    expect(src).toContain("isWeekdayHiddenByPresentation");
    expect(src).toContain("Where your published promotions show up");
    expect(src).toContain("hiddenByPresentation");
    // deep link back to the presentation editor
    expect(src).toContain('href="/admin/specials"');
  });
});
