/**
 * D234 slice C-7 (SOP-11b G-102, G-103; F-11-26, F-11-27; owner Q-11-16
 * "yes"): one schedule everywhere (repeat days/hours + fallback for Shop
 * banner slides and type cards, enforced for visitors; calendars on Shop
 * Banner, Type cards and Schedule & Releases) and "Preview as of".
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { __runScheduleEverywhereCoreTests, previewAsOf, type AsOfItem } from "../../src/lib/cms/schedule-everywhere-core";
import {
  defaultShopHeroPresentation,
  isSlideLiveAt,
  normalizeShopHeroPresentation,
  pickLiveShopSlides,
  serializeShopHeroPresentation,
} from "../../src/lib/cms/shop-carousel-core";
import { hideOutOfWindowTypeCards, isTypeCardLiveAt, normalizeTypeCards } from "../../src/lib/cms/type-cards-core";
import { BannerScheduleCalendar } from "../../src/components/admin/BannerScheduleCalendar";
import { ScheduleRepeatFields } from "../../src/components/admin/ScheduleRepeatFields";
import { CONCIERGE_KB } from "../../src/lib/admin/concierge-kb";
import { PAGE_HELPERS } from "../../src/lib/admin/page-helpers-core";

const read = (p: string) => readFileSync(p, "utf8");
// 2026-01-14 is a Wednesday; 20:00Z = 12:00 PST.
const WED_NOON = Date.parse("2026-01-14T20:00:00Z");
const THU_NOON = Date.parse("2026-01-15T20:00:00Z");

describe("C-7: the pure core", () => {
  it("self-test passes and is registered in the runner", () => {
    const r = __runScheduleEverywhereCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(23);
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runScheduleEverywhereCoreTests } from "../../src/lib/cms/schedule-everywhere-core";');
    expect(runner).toContain('assertRan("schedule-everywhere-core", __runScheduleEverywhereCoreTests(), 23);');
  });

  it("preview as of: a timed release before then is applied; an untimed one is listed", () => {
    const items: AsOfItem[] = [{ kind: "shop_slide", key: "a", area: "Shop banner", label: "Sale", enabled: false, fields: null, draftFields: {} }];
    const r = previewAsOf(
      items,
      [{ id: "1", target_kind: "shop_slide", target_key: "a", target_label: "Sale", action: "publish", run_at: null, status: "pending", release_id: "R" }],
      [{ id: "R", name: "Sale", status: "scheduled", run_at: "2026-11-27T08:00:00Z" }],
      Date.parse("2026-11-20T00:00:00Z"),
      Date.parse("2026-11-27T20:00:00Z"),
    );
    expect(r.areas.find((a) => a.area === "Shop banner")!.live.map((e) => e.key)).toEqual(["a"]);
  });
});

describe("C-7: Shop banner slides", () => {
  it("old slides serialize byte-identically; repeats are stored only when used", () => {
    const def = defaultShopHeroPresentation();
    const before = serializeShopHeroPresentation(def);
    expect(before).not.toContain("scheduleDays");
    expect(before).not.toContain("fallback");
    const withRepeat = normalizeShopHeroPresentation({ ...def, scheduleDays: ["fri", "sat"], scheduleFrom: "16:00", scheduleTo: "21:00", fallback: true });
    const json = JSON.parse(serializeShopHeroPresentation(withRepeat));
    expect(json.scheduleDays).toEqual(["fri", "sat"]);
    expect(json.scheduleFrom).toBe("16:00");
    expect(json.fallback).toBe(true);
    expect(normalizeShopHeroPresentation({ ...def, scheduleFrom: "16:00" }).scheduleFrom).toBeUndefined();
  });

  it("repeat days are honoured and the fallback slide fills in", () => {
    const wed = normalizeShopHeroPresentation({ ...defaultShopHeroPresentation(), scheduleDays: ["wed"] });
    expect(isSlideLiveAt(wed, WED_NOON)).toBe(true);
    expect(isSlideLiveAt(wed, THU_NOON)).toBe(false);
    const fb = normalizeShopHeroPresentation({ ...defaultShopHeroPresentation(), fallback: true });
    const slides = [
      { key: "w", presentation: wed },
      { key: "f", presentation: fb },
    ];
    expect(pickLiveShopSlides(slides, false, WED_NOON).map((s) => s.key)).toEqual(["w"]);
    expect(pickLiveShopSlides(slides, false, THU_NOON).map((s) => s.key)).toEqual(["f"]);
    expect(pickLiveShopSlides(slides, true, THU_NOON).map((s) => s.key)).toEqual(["w", "f"]);
  });

  it("the public Shop banner now applies the schedule (it ignored it before)", () => {
    const store = read("src/lib/cms/shop-carousel-store.ts");
    expect(store).toContain("const resolved = pickLiveShopSlides(withContent, preview, Date.now());");
  });

  it("the editor has the repeat controls and the page has the calendar", () => {
    expect(read("src/components/admin/ShopBannerEditor.tsx")).toContain('<ScheduleRepeatFields\n                value={pres}\n                noun="slide"');
    const page = read("src/app/admin/content/shop-banner/page.tsx");
    expect(page).toContain("<BannerScheduleCalendar");
    expect(page).toContain('emptyFallback="the Shop page falls back to its built-in starter banner"');
  });
});

describe("C-7: type cards", () => {
  it("repeats and fallback on a card", () => {
    const [wed, fb] = normalizeTypeCards([
      { id: "w", label: "W", adv: { scheduleDays: ["wed"] } },
      { id: "f", label: "F", adv: { fallback: true } },
    ]);
    expect(wed!.adv?.scheduleDays).toEqual(["wed"]);
    expect(isTypeCardLiveAt(wed!, THU_NOON)).toBe(false);
    expect(hideOutOfWindowTypeCards([wed!, fb!], false, WED_NOON).map((c) => c.id)).toEqual(["w"]);
    expect(hideOutOfWindowTypeCards([wed!, fb!], false, THU_NOON).map((c) => c.id)).toEqual(["f"]);
    expect(hideOutOfWindowTypeCards([wed!, fb!], true, THU_NOON)).toHaveLength(2);
    expect("adv" in normalizeTypeCards([{ id: "x", label: "X", adv: { fallback: false, scheduleDays: [] } }])[0]!).toBe(false);
  });

  it("the editor and the Type cards tab", () => {
    expect(read("src/components/admin/TypeCardImagesEditor.tsx")).toContain('noun="card"');
    expect(read("src/app/admin/pages/[slug]/page.tsx")).toContain('anchorPrefix="tc-label-"');
  });
});

describe("C-7: shared UI", () => {
  it("the repeat controls render the seven days and the fallback tick", () => {
    const html = renderToStaticMarkup(<ScheduleRepeatFields value={{ scheduleDays: ["fri"] }} noun="card" inputClass="" onChange={() => {}} />);
    expect(html).toContain("Repeat on (none ticked = every day)");
    expect(html).toContain("Fallback card");
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
    expect(html).toContain("Summary: Every Fri");
  });

  it("the calendar keeps the home wording by default and takes another noun", () => {
    const home = renderToStaticMarkup(<BannerScheduleCalendar banners={[]} anchorPrefix="slide-" nowMs={WED_NOON} />);
    expect(home).toContain("the homepage falls back to the built-in starter slides");
    const cards = renderToStaticMarkup(<BannerScheduleCalendar banners={[]} anchorPrefix="" nowMs={WED_NOON} noun="card" emptyFallback="the row is empty" title="Type cards calendar" />);
    expect(cards).toContain("No fallback card is set");
    expect(cards).toContain("Type cards calendar");
  });
});

describe("C-7: Schedule & Releases", () => {
  it("has Preview as of and the calendars", () => {
    const page = read("src/app/admin/content/schedule/page.tsx");
    expect(page).toContain("<AsOfSection");
    expect(page).toContain("const asOfMs = parseAsOf(sp.asof);");
    const sec = read("src/app/admin/content/schedule/AsOfSection.tsx");
    expect(sec).toContain('name="asof"');
    expect(sec).toContain("Preview as of");
    expect(sec).toContain("<BannerScheduleCalendar");
  });

  it("the Loyalty and Specials banners have their own group", () => {
    const srv = read("src/lib/cms/content-schedule-server.ts");
    expect(srv).toContain('"loyalty.hero.presentation": "Loyalty page banner"');
    expect(srv).toContain("Loyalty & Specials banners (publish only)");
  });

  it("the helper and the concierge say what is true now", () => {
    const kb = CONCIERGE_KB.find((k) => k.id === "content-schedule")!.facts.join(" ");
    expect(kb).not.toContain("start/end only today");
    expect(kb).not.toContain("preview yet");
    expect(kb).toContain("Preview as of");
    expect(PAGE_HELPERS.find((h) => h.id === "content-schedule")!.steps.join(" ")).toContain("Preview as of");
  });
});

describe("C-7: docs", () => {
  it("SOP-11b v2.7 and the program records say BUILT", () => {
    const sop = read("docs/sop/SOP-11b-creative-studio-banner-studio-scheduling.md");
    expect(sop).toContain("v2.7 = slice C-7");
    expect(sop).toContain("| 2.7 | 2026-11-11 | Slice C-7");
    expect(sop).not.toContain('There is no "show me the site as it will look on Friday" preview yet');
    expect(read("docs/sop-program/05-GAP-REGISTER.md")).toContain("C-7 BUILT (G-102, G-103).");
    expect(read("docs/sop-program/06-FIX-PHASE-PLAN.md")).toContain("Preview as of — **BUILT (D234)**");
    expect(read("docs/sop-program/00-OWNER-REQUEST-VERBATIM.md")).toContain("### As built (slice C-7)");
  });
});
