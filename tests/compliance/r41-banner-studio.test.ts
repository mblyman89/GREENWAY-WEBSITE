/**
 * R41 S2 — Banner Studio wiring guard (bible SLICE S2 part (c)).
 *
 * Source-level locks for the owner-facing promises:
 *  - Enter makes a new line (textareas + CRLF → "\n" on save + pre-line render)
 *  - "Pick a link…" exists on classic buttons and studio buttons
 *  - Custom design is opt-in, starts from today's look (designFromLegacy),
 *    and is merged into settings_json with writeDesign (siblings kept)
 *  - the server never trusts the posted design (normalizeDesign) and drops
 *    script / protocol-relative button links
 *  - the studio keeps a keyboard alternative to dragging (WCAG 2.2 SC 2.5.7)
 *  - the LinkPicker renders in a portal (Enter in it can't submit the form)
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const STUDIO = "src/components/admin/banner-studio";

describe("R41 S2 Banner Studio", () => {
  it("studio files exist, are client components and stay under ~500 lines", () => {
    for (const f of ["BannerStudio", "StudioCanvas", "TextBoxPanel", "ButtonPanel", "ImagePanel", "WarningsPanel", "LinkPicker", "controls"]) {
      const p = `${STUDIO}/${f}.tsx`;
      expect(existsSync(path.join(ROOT, p)), p).toBe(true);
      const src = read(p);
      expect(src.startsWith('"use client";'), p).toBe(true);
      expect(src.split("\n").length, p).toBeLessThan(520);
    }
  });

  it("SectionCard: textareas for eyebrow/title/subtitle (Enter = new line)", () => {
    const src = read("src/components/admin/SectionCard.tsx");
    for (const n of ["eyebrow", "title", "subtitle"]) {
      expect(src).toMatch(new RegExp(`<AutoTextarea[\\s\\S]{0,80}name="${n}"`));
    }
  });

  it("SectionCard: link picker + plain-English link description on classic buttons", () => {
    const src = read("src/components/admin/SectionCard.tsx");
    expect(src).toContain("setPickingFor(b._id)");
    expect(src).toContain("<LinkPicker");
    expect(src).toContain("describeHref(b.href, { blogTitles })");
  });

  it("SectionCard: custom design opt-in, legacy start, writeDesign merge, lazy studio", () => {
    const src = read("src/components/admin/SectionCard.tsx");
    // R61 S1: the opt-in / legacy start / keep-when-off / lazy studio now live
    // in the ONE shared shell every banner editor uses.
    expect(src).toContain('import { BasicMode, DesignCard } from "./banner-studio/BannerEditorShell"');
    expect(src).toContain("<DesignCard");
    expect(src).toContain("seed={designSeed}");
    expect(src).toContain("writeDesign(baseSettings, design)");
    const shell = read("src/components/admin/banner-studio/BannerEditorShell.tsx");
    expect(shell).toContain("designFromLegacy({ ...seed, preset })");
    expect(shell).toContain("onChange({ ...design, enabled: false })");
    expect(shell).toContain('dynamic(() => import("@/components/admin/banner-studio/BannerStudio")');
    // the SLICE 112 pins still hold
    expect(src).toContain('name="settings_json"');
    expect(src).toContain('d.settings.lanes === "brand"');
  });

  it("save action: CRLF → \\n for text fields, design re-normalized, unsafe links dropped", () => {
    const src = read("src/app/admin/pages/[slug]/actions.ts");
    expect(src).toContain('.replace(/\\r\\n?/g, "\\n")');
    for (const n of ["eyebrow", "title", "subtitle", "body"]) expect(src).toContain(`${n}: multiline(formData.get("${n}"))`);
    expect(src).toContain("normalizeDesign");
    expect(src).toContain("if (isDangerousHref(href)) continue;");
  });

  it("admin page passes published posts to the picker (light query, no media lookups)", () => {
    const page = read("src/app/admin/pages/[slug]/page.tsx");
    expect(page).toContain("listPublishedPostLinks()");
    expect(page).toContain("posts={posts}");
    const store = read("src/lib/cms/blog-store.ts");
    expect(store).toMatch(/listPublishedPostLinks[\s\S]*\.select\("slug,title,kind"\)[\s\S]*\.eq\("status", "published"\)/);
  });

  it("canvas: pointer capture drag + keyboard nudge/delete/escape (WCAG 2.5.7)", () => {
    const src = read(`${STUDIO}/StudioCanvas.tsx`);
    expect(src).toContain("setPointerCapture(e.pointerId)");
    expect(src).toContain("onPointerCancel={endDrag}");
    expect(src).toContain("nudge(designRef.current");
    expect(src).toMatch(/e\.key === "Delete"/);
    expect(src).toMatch(/e\.key === "Escape"/);
    expect(src).toContain("touchAction: \"none\"");
    // WYSIWYG: same pure style helpers as the public DesignedBanner
    for (const fn of ["containerStyle(card)", "frameStyle(design)", "imageStyle(design)", "boxStyle(b, card)", "buttonStyle(btn, card)"]) expect(src).toContain(fn);
  });

  it("text panel offers roles WITH purpose, dos and don'ts", () => {
    const src = read(`${STUDIO}/TextBoxPanel.tsx`);
    expect(src).toContain("DESIGN_ROLES.map((r)");
    expect(src).toContain("{r.purpose}");
    expect(src).toContain("{r.dos}");
    expect(src).toContain("{r.donts}");
    for (const l of ["Bold", "Italic", "Underline", "Strikethrough"]) expect(src).toContain(`label="${l}"`);
  });

  it("LinkPicker: portal, checkHref gate, describeHref, every tab", () => {
    const src = read(`${STUDIO}/LinkPicker.tsx`);
    expect(src).toContain("createPortal(");
    expect(src).toContain('disabled={!href || check.level === "block"}');
    expect(src).toContain("describeHref(href, { blogTitles })");
    for (const t of ["menu", "category", "blog", "page", "contact", "external", "anchor"]) expect(src).toContain(`id: "${t}"`);
  });
});
