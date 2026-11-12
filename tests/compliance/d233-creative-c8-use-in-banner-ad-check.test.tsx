/**
 * D234 slice C-8 (SOP-11b G-104, G-105; F-11-28, F-11-29; owner Q-11-14
 * "warn with tick"): Creative Studio → Use in a banner (with the banner's real
 * picture size) and the advertising-rule check with the required picture tick.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BANNER_TARGETS,
  PICTURE_TICK_FIELD,
  PICTURE_TICK_LABEL,
  __runAdCheckCoreTests,
  adPromptWarnings,
  bannerTargetById,
  checkAdText,
  makeForBannerHref,
  pictureTickOk,
  readStudioQuery,
  sectionTargetId,
  studioSizeFor,
  bannerLinkFor,
} from "../../src/lib/marketing/ad-check-core";
import { AdCheckStrip, StudioPictureRow } from "../../src/components/admin/BannerHandoff";
import { UseInBanner } from "../../src/components/admin/marketing/flux/UseInBanner";
import { PictureTickField } from "../../src/components/admin/SchedulePanel";
import { CONCIERGE_KB } from "../../src/lib/admin/concierge-kb";
import { PAGE_HELPERS } from "../../src/lib/admin/page-helpers-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("C-8: the pure core", () => {
  it("self-test passes and is registered in the runner", () => {
    const r = __runAdCheckCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(30);
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runAdCheckCoreTests } from "../../src/lib/marketing/ad-check-core";');
    expect(runner).toContain('assertRan("ad-check-core", __runAdCheckCoreTests(), 30);');
  });

  it("flags minors and medical words, skips prices, warns in prompts", () => {
    expect(checkAdText(["Candy gummies for kids"]).some((f) => f.kind === "rule")).toBe(true);
    expect(checkAdText(["20% off this weekend"])).toHaveLength(0);
    expect(adPromptWarnings("a cartoon bear eating candy").every((w) => w.startsWith("Advertising check:"))).toBe(true);
    expect(adPromptWarnings("a cartoon bear eating candy").length).toBeGreaterThan(0);
    expect(adPromptWarnings("a calm sunset over the Cascades")).toHaveLength(0);
  });

  it("the server tick rule: banners going live need it, coming down does not", () => {
    expect(pictureTickOk("shop_slide", "x", "publish", null)).toBe(false);
    expect(pictureTickOk("shop_slide", "x", "publish", "1")).toBe(true);
    expect(pictureTickOk("shop_slide", "x", "unpublish", null)).toBe(true);
    expect(pictureTickOk("faq_item", "x", "publish", null)).toBe(true);
    expect(pictureTickOk("content_block", "loyalty.hero.presentation", "publish", null)).toBe(false);
    expect(pictureTickOk("content_block", "home.hero.title", "publish", null)).toBe(true);
  });

  it("Use in a banner links and the studio size round-trip", () => {
    expect(BANNER_TARGETS.length).toBeGreaterThanOrEqual(10);
    expect(sectionTargetId("home", "home.category")).toBe("home-types");
    expect(sectionTargetId("faq", "faq.intro")).toBe("faq");
    const href = bannerLinkFor(bannerTargetById("home-main")!, "https://x/a.jpg", "slide-9");
    expect(href).toBe("/admin/pages/home?tab=carousel&useImage=https%3A%2F%2Fx%2Fa.jpg#slide-9");
    const make = makeForBannerHref("shop", { w: 1920, h: 640 }, "slide-2");
    const q = new URLSearchParams(make.split("?")[1]);
    const back = readStudioQuery((k) => q.get(k));
    expect(back.target?.id).toBe("shop");
    expect(back.slot).toBe("slide-2");
    expect(back.size).toEqual(studioSizeFor(1920, 640));
    expect(back.size!.w * back.size!.h).toBeLessThanOrEqual(4_194_304);
  });
});

describe("C-8: shared UI", () => {
  it("AdCheckStrip shows the findings and the picture tick", () => {
    const html = renderToStaticMarkup(<AdCheckStrip texts={["Candy deals for kids"]} checked={false} onChange={() => {}} />);
    expect(html).toContain("data-ad-check");
    expect(html).toContain("data-ad-findings");
    expect(html).toContain(PICTURE_TICK_LABEL);
    expect(html).toContain("Publish turns on when this is ticked.");
    const clean = renderToStaticMarkup(<AdCheckStrip texts={["Fresh Friday drops"]} checked onChange={() => {}} />);
    expect(clean).toContain("No banned words found");
  });

  it("StudioPictureRow links to the studio with the banner's size", () => {
    const html = renderToStaticMarkup(<StudioPictureRow targetId="shop" anchor="slide-3" onUse={() => {}} />);
    expect(html).toContain("data-studio-picture");
    expect(html).toContain("/admin/marketing/midjourney?for=shop");
    expect(html).toContain("slot=slide-3");
  });

  it("UseInBanner preselects the banner that asked", () => {
    const html = renderToStaticMarkup(<UseInBanner imageUrl="https://x/a.jpg" initialTarget="shop" slot="slide-3" />);
    expect(html).toContain("data-use-in-banner");
    expect(html).toContain("Open the banner editor");
    expect(html).toContain("/admin/content/shop-banner?useImage=https%3A%2F%2Fx%2Fa.jpg#slide-3");
  });

  it("PictureTickField only on banner kinds (unless always)", () => {
    expect(renderToStaticMarkup(<PictureTickField kind="faq_item" targetKey="x" />)).toBe("");
    const html = renderToStaticMarkup(<PictureTickField kind="carousel_slide" targetKey="x" />);
    expect(html).toContain(`name="${PICTURE_TICK_FIELD}"`);
    expect(html).toContain(PICTURE_TICK_LABEL);
    expect(renderToStaticMarkup(<PictureTickField always />)).toContain(PICTURE_TICK_LABEL);
  });
});

describe("C-8: wiring", () => {
  it("every banner editor has the check and gates Publish on the tick", () => {
    const editors = [
      "src/components/admin/ShopBannerEditor.tsx",
      "src/components/admin/CarouselSlideCard.tsx",
      "src/components/admin/SectionCard.tsx",
      "src/components/admin/LoyaltyHeroEditor.tsx",
      "src/components/admin/SpecialsPresentationEditor.tsx",
      "src/components/admin/about/AboutSidePanelEditor.tsx",
      "src/components/admin/TypeCardImagesEditor.tsx",
    ];
    for (const f of editors) {
      const s = read(f);
      expect(s, f).toContain("<AdCheckStrip");
      expect(s, f).toMatch(/!pictureOk/);
    }
    for (const f of editors.slice(0, 6)) expect(read(f), f).toContain("<StudioPictureRow");
  });

  it("the server refuses a banner Go live without the tick", () => {
    const a = read("src/app/admin/content/schedule/actions.ts");
    expect(a).toContain("pictureTickOk(v.value.kind, v.value.key, v.value.action, formData.get(PICTURE_TICK_FIELD))");
    const r = read("src/app/admin/content/schedule/release-actions.ts");
    expect(r).toContain("pictureTickOk(kind, key, action, fd.get(PICTURE_TICK_FIELD))");
    expect(read("src/app/admin/content/schedule/page.tsx")).toContain("<PictureTickField always />");
    expect(read("src/app/admin/content/schedule/ReleasesSection.tsx")).toContain("<PictureTickField always />");
    expect(read("src/components/admin/SchedulePanel.tsx")).toContain("<PictureTickField kind={kind} targetKey={targetKey} />");
  });

  it("both studios add the prompt warnings; results offer Use in a banner", () => {
    expect(read("src/components/admin/marketing/flux/FluxImageStudio.tsx")).toContain("...adPromptWarnings(prompt)");
    expect(read("src/components/admin/marketing/flux/FluxVideoStudio.tsx")).toContain("...adPromptWarnings(prompt)");
    expect(read("src/components/admin/marketing/flux/FluxResults.tsx")).toContain("<UseInBanner");
  });

  it("the concierge and helper say it", () => {
    const kb = (id: string) => CONCIERGE_KB.find((t) => t.id === id)?.facts?.join(" ") ?? "";
    expect(kb("image-generator")).toContain("Use in a banner");
    expect(kb("banner-studio")).toContain("I checked the picture for minors appeal");
    const h = PAGE_HELPERS.find((x) => x.id === "midjourney-builder")!;
    expect(h.steps.join(" ")).toContain("Use in a banner");
  });
});

describe("C-8: docs", () => {
  it("SOP-11b v2.8 and the program records say BUILT", () => {
    const sop = read("docs/sop/SOP-11b-creative-studio-banner-studio-scheduling.md");
    expect(sop).toContain("v2.8 = slice C-8");
    expect(sop).toContain("| 2.8 | 2026-11-11 | Slice C-8");
    expect(sop).not.toContain('There is no "Use in a banner" button yet');
    expect(sop).not.toContain("checks these rules today (F-11-29)");
    expect(read("docs/sop-program/05-GAP-REGISTER.md")).toContain("C-8 BUILT (G-104, G-105).");
    expect(read("docs/sop-program/06-FIX-PHASE-PLAN.md")).toContain("advertising-rule check — **BUILT (D234)**");
    expect(read("docs/sop-program/00-OWNER-REQUEST-VERBATIM.md")).toContain("### As built (slice C-8)");
  });
});
