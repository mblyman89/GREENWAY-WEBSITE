/**
 * tests/compliance/r41-move-mode.test.ts — R41 S7 hub preview "Move mode".
 *
 * Locks: the pure movers + drag geometry, the server action's guard rails
 * (permission, re-validation, drafts only, audit), the iframe/parent message
 * contract (origin + source checks), and that Move hooks are exposed ONLY in
 * Draft Mode on every banner kind.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { __runDesignMoveCoreTests, parseDesignOwner, publicPathFor, editorFor } from "@/lib/cms/design-move-core";
import { __runDesignDragCoreTests, deviceForFrameWidth, dropPercent } from "@/lib/cms/design-drag-core";
import { parseMoveMessage } from "@/lib/cms/banner-design-core";

const read = (p: string) => readFileSync(p, "utf8");
const U = "123e4567-e89b-12d3-a456-426614174000";

describe("R41 S7 pure cores", () => {
  it("design-move-core self-tests pass", () => {
    expect(__runDesignMoveCoreTests().passed).toBeGreaterThanOrEqual(58);
  });
  it("design-drag-core self-tests pass", () => {
    expect(__runDesignDragCoreTests().passed).toBeGreaterThanOrEqual(16);
  });
  it("owner parsing matches parseMoveMessage's allow-list", () => {
    for (const o of [`section:${U}`, `shop-slide:${U}`, `home-slide:${U}`, "specials:hero", "specials:todays", "loyalty:hero"]) {
      expect(parseDesignOwner(o)).not.toBeNull();
      expect(parseMoveMessage({ type: "gw-design-move", owner: o, target: "box", id: "headline", x: 1, y: 2, device: "desktop" })).not.toBeNull();
    }
    expect(parseDesignOwner("home:hero")).toBeNull();
  });
  it("device follows the banner width like the CSS container query", () => {
    const css = read("src/app/globals.css");
    expect(css).toContain("@container gwb (max-width: 767px)");
    expect(deviceForFrameWidth(767)).toBe("mobile");
    expect(deviceForFrameWidth(768)).toBe("desktop");
  });
  it("drop is the top-left corner in % of the frame", () => {
    expect(dropPercent({ left: 10, top: 10, width: 5, height: 5 }, { left: 0, top: 0, width: 200, height: 100 }, 10, 10)).toEqual({ x: 10, y: 20 });
  });
  it("links + paths", () => {
    expect(publicPathFor({ kind: "section", id: U }, "about")).toBe("/about");
    expect(editorFor({ kind: "shop-slide", id: U }).href).toBe("/admin/content/shop-banner");
  });
});

describe("R41 S7 server action", () => {
  const src = read("src/app/admin/website-sync/design-actions.ts");
  it("is a server file that only exports async functions + types", () => {
    expect(src.startsWith('"use server";')).toBe(true);
    const exports = src.match(/^export (?!type )\S+ \S+/gm) ?? [];
    for (const e of exports) expect(e).toMatch(/^export async function/);
  });
  it("checks permission first, re-validates, saves drafts only, audits", () => {
    const body = src.slice(src.indexOf("export async function saveDesignMoveAction"));
    expect(body.indexOf('requirePermission("content.edit")')).toBeGreaterThan(-1);
    expect(body.indexOf('requirePermission("content.edit")')).toBeLessThan(body.indexOf("parseMoveMessage(input)"));
    for (const k of ["saveSectionDraft(", "saveContentDraft(SPECIALS_PRESENTATION_BLOCK", "saveContentDraft(LOYALTY_HERO_PRESENTATION_BLOCK", "saveShopCarouselDraft("]) {
      expect(body).toContain(k);
    }
    expect(body).not.toMatch(/\bpublish\w*\(/i); // a move never publishes
    expect(body).toContain("row.locked");
    expect(body).toContain('action: "design.move"');
    expect(body).toContain("draft_settings ?? row.settings");
    expect(body).toContain("slide.draft_presentation ?? slide.presentation");
  });
});

describe("R41 S7 iframe + parent contract", () => {
  const drag = read("src/components/site/PreviewDesignDrag.tsx");
  const frame = read("src/components/admin/PreviewFrame.tsx");
  const panel = read("src/components/admin/WebsiteSyncPreviewPanel.tsx");
  it("iframe side: inert outside a frame, origin + parent checked, posts to own origin", () => {
    expect(drag).toContain("if (window.self === window.top) return;");
    expect(drag).toContain("e.origin !== origin || e.source !== window.parent");
    expect(drag).toContain("window.parent.postMessage(data, origin)");
    expect(drag).toContain("setPointerCapture");
    expect(drag).toContain('"Escape"');
    expect(drag).toContain('"Enter"');
  });
  it("mounted by the Draft-Mode-only overlay", () => {
    expect(read("src/components/site/PreviewEditOverlay.tsx")).toContain("<PreviewDesignDrag />");
    expect(read("src/app/(site)/layout.tsx")).toContain("{isPreview && <PreviewEditOverlay");
  });
  it("parent side: own iframe + origin only, re-validates, ignores moves when off", () => {
    expect(frame).toContain("e.source !== frameRef.current.contentWindow");
    expect(frame).toContain("parseMoveMessage(data)");
    expect(frame).toContain('data?.type === "gw-design-move" && moveRef.current');
    expect(frame).toContain("onLoad={sendMoveMode}");
  });
  it("panel: gated by canMove, saves via the action, toasts, reloads", () => {
    expect(panel).toContain("saveDesignMoveAction(");
    expect(panel).toContain("moveMode={canMove && moveMode}");
    expect(panel).toContain("setReload(");
    expect(read("src/app/admin/website-sync/page.tsx")).toContain('canMove={can(role, "content.edit")}');
  });
});

describe("R41 S7 Draft-Mode-only hooks on every banner", () => {
  it("getPageBanners marks editable only in Draft Mode", () => {
    const s = read("src/lib/cms/page-sections-store.ts");
    const fn = s.slice(s.indexOf("export async function getPageBanners"), s.indexOf("export type BannerData"));
    expect(fn).toContain("(await draftMode()).isEnabled");
    expect(fn).toContain("if (preview) data.editable = true;");
  });
  it("extras pass editable through", () => {
    for (const f of ["src/components/specials/SpecialsContent.tsx", "src/components/menu/ShopPage.tsx", "src/components/vendors/VendorDirectory.tsx"]) {
      expect(read(f)).toContain("editable={s.editable}");
    }
  });
  it("vendors grow/brands + today's deal pass editable", () => {
    const v = read("src/components/vendors/VendorDirectory.tsx");
    expect(v).toContain("designOwner={content?.grow?.designOwner}\n          editable={content?.editable}");
    expect(v).toContain("designOwner={content?.brands?.designOwner}\n          editable={content?.editable}");
    expect(read("src/components/specials/SpecialsContent.tsx")).toContain("design={pres.todaysDealsDesign}\n            editable={content?.editable}");
    expect(read("src/components/specials/SpecialsDailyDeals.tsx")).toContain("editable={editable}");
  });
  it("DesignedBanner only emits hooks when editable", () => {
    const d = read("src/components/site/DesignedBanner.tsx");
    expect(d).toContain('editable && owner ? { "data-gw-design-frame": "true", "data-gw-design-owner": owner }');
    expect(d).toContain('editable ? { "data-gw-design-box": b.id }');
    expect(d).toContain('editable ? { "data-gw-design-button": btn.id }');
  });
});

describe("R48 Home slide Move mode", () => {
  it("Hero passes a home-slide owner to DesignedBanner only in preview", () => {
    const hero = read("src/components/home/Hero.tsx");
    expect(hero).toContain("designOwner={editable && slide.id ? `home-slide:${slide.id}` : undefined}");
    expect(hero).toContain("editable={!!designOwner}");
  });
  it("the action saves home slides as a DRAFT via saveCarouselDraft", () => {
    const act = read("src/app/admin/website-sync/design-actions.ts");
    expect(act).toContain('case "home-slide"');
    expect(act).toContain("saveCarouselDraft(owner.id, { advanced: serializeHomeSlideAdvanced(r.value) }, session.userId)");
    expect(act).not.toContain("publishCarouselSlide");
  });
});
