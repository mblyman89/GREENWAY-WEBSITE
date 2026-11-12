/**
 * D234 slice C-6 (SOP-11b G-106, G-107; F-11-30, F-11-31): help inside the
 * Banner Design Studio (tooltips, "?" sheet, first-use tour, "Make a banner"
 * step strip, the `banner-studio` helper, concierge topics, empty states) and
 * the Save-to-brand name dialog that replaces the browser prompt box.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultDesign, type BannerDesign } from "../../src/lib/cms/banner-design-core";
import {
  __runStudioHelpCoreTests,
  STUDIO_SHORTCUTS,
  TAB_HELP,
  makeBannerSteps,
  nextStep,
  suggestBrandName,
  brandNameError,
  brandNameNote,
} from "../../src/lib/cms/studio-help-core";
import { KeySheet, StepStrip, Tip, TourStrip } from "../../src/components/admin/banner-studio/StudioHelp";
import { BrandNameDialog } from "../../src/components/admin/banner-studio/BrandNameDialog";
import { PAGE_HELPERS, __runPageHelpersTests, helperHref } from "../../src/lib/admin/page-helpers-core";
import { CONCIERGE_KB } from "../../src/lib/admin/concierge-kb";

const read = (p: string) => readFileSync(p, "utf8");
const noop = () => {};
const DIR = "src/components/admin/banner-studio/";

describe("C-6: the pure help core", () => {
  it("self-test passes and is registered in the runner", () => {
    const r = __runStudioHelpCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBe(22);
    const runner = read("scripts/compliance/run-pure-selftests.ts");
    expect(runner).toContain('import { __runStudioHelpCoreTests } from "../../src/lib/cms/studio-help-core";');
    expect(runner).toContain('assertRan("studio-help-core", __runStudioHelpCoreTests(), 22);');
  });

  it("every tab has words, and ? is the first key on the sheet", () => {
    for (const t of ["text", "buttons", "shapes", "anims", "animate", "smoke", "layers", "picture", "checks"]) {
      expect((TAB_HELP as Record<string, string>)[t]?.length ?? 0).toBeGreaterThan(10);
    }
    expect(STUDIO_SHORTCUTS[0].keys).toBe("?");
  });

  it("the step strip starts at Picture for an empty banner", () => {
    const steps = makeBannerSteps({ design: defaultDesign("hero"), imageSrc: "", seenPhone: false, warnCount: 0 });
    expect(steps.map((s) => s.id)).toEqual(["picture", "text", "phone", "check", "publish"]);
    expect(nextStep(steps)).toBe("picture");
  });
});

describe("C-6: the help pieces render", () => {
  it("Tip links the control to its words with aria-describedby (read even when closed)", () => {
    const html = renderToStaticMarkup(
      <Tip text="Words for the button">
        <button type="button">X</button>
      </Tip>,
    );
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("sr-only");
    expect(html).toContain("Words for the button");
  });

  it("TourStrip shows until hidden; StepStrip lists the five steps", () => {
    expect(renderToStaticMarkup(<TourStrip visible onStart={noop} onDismiss={noop} />)).toContain("New here? Take the 60-second tour of the studio.");
    expect(renderToStaticMarkup(<TourStrip visible={false} onStart={noop} onDismiss={noop} />)).toBe("");
    const steps = makeBannerSteps({ design: defaultDesign("hero"), imageSrc: "/x.jpg", seenPhone: false, warnCount: 2 });
    const html = renderToStaticMarkup(<StepStrip steps={steps} onGo={noop} />);
    expect(html).toContain("data-step-strip");
    expect(html).toContain("Make a banner:");
    for (const l of ["Picture", "Text", "Phone", "Check", "Publish"]) expect(html).toContain(l);
    expect(html).toContain("✓ ");
  });

  it("KeySheet is a dialog with every key and links to the banner-studio helper", () => {
    expect(renderToStaticMarkup(<KeySheet mode={false} onMode={noop} onClose={noop} onGo={noop} />)).toBe("");
    const html = renderToStaticMarkup(<KeySheet mode="keys" onMode={noop} onClose={noop} onGo={noop} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("data-key-sheet");
    expect(html).toContain(helperHref("banner-studio"));
    expect(helperHref("banner-studio")).toBe("/admin/helpers#banner-studio");
  });

  it("the studio wires the help in (tabs wrapped in Tip, ? sheet, strips)", () => {
    const s = read(DIR + "BannerStudio.tsx");
    expect(s).toContain("<Tip key={id} text={TAB_HELP[id]}>");
    expect(s).toContain("<TourStrip");
    expect(s).toContain("<StepStrip steps={steps} onGo={goStep} />");
    expect(s).toContain("<KeySheet");
    // The long one-line shortcut guide moved into the ? sheet.
    expect(s).not.toContain("hold Alt to stop snapping · Delete removes");
  });
});

describe("C-6: Save to brand asks for the name in a dialog", () => {
  it("no browser prompt box in the brand row; the dialog is used", () => {
    const s = read(DIR + "BannerEditorShell.tsx");
    expect(s).not.toContain("window.prompt");
    expect(s).toContain("<BrandNameDialog");
    expect(s).toContain("suggestBrandName(design)");
  });

  it("the dialog starts with the headline and explains the name rules", () => {
    const d = defaultDesign("hero") as BannerDesign;
    const initial = suggestBrandName(d);
    const html = renderToStaticMarkup(<BrandNameDialog open initial={initial} existing={[]} busy={false} onSave={noop} onCancel={noop} />);
    expect(html).toContain("data-brand-name-dialog");
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Save to brand banners");
    expect(renderToStaticMarkup(<BrandNameDialog open={false} initial="x" existing={null} busy={false} onSave={noop} onCancel={noop} />)).toBe("");
    expect(brandNameError("")).not.toBeNull();
    expect(brandNameNote("Promo", [{ name: "promo" }])).toContain("adds another");
    const dup = renderToStaticMarkup(<BrandNameDialog open initial="Promo" existing={[{ name: "promo" }]} busy={false} onSave={noop} onCancel={noop} />);
    expect(dup).toContain("adds another");
  });
});

describe("C-6: empty states, helper and concierge", () => {
  it("text, buttons and layers explain what to do when empty", () => {
    expect(read(DIR + "TextBoxPanel.tsx")).toContain('data-empty-state="text"');
    expect(read(DIR + "ButtonPanel.tsx")).toContain('data-empty-state="buttons"');
    expect(read(DIR + "LayersPanel.tsx")).toContain('data-empty-state="layers"');
  });

  it("the banner-studio helper exists and the helper self-test still passes", () => {
    const h = PAGE_HELPERS.find((x) => x.id === "banner-studio");
    expect(h?.section).toBe("Website: Cannabis");
    expect(h?.title).toBe("How the Banner Design Studio works");
    expect(__runPageHelpersTests().failed).toBe(0);
  });

  it("the concierge knows the studio, Branding and scheduling", () => {
    for (const id of ["banner-studio", "branding", "content-schedule"]) {
      const t = CONCIERGE_KB.find((k) => k.id === id);
      expect(t?.tab).toBe("Website");
      expect(t?.facts.length ?? 0).toBeGreaterThan(2);
    }
    expect(CONCIERGE_KB.find((k) => k.id === "content-schedule")!.facts.join(" ")).toContain("5-minute clock");
    expect(new Set(CONCIERGE_KB.map((k) => k.id)).size).toBe(CONCIERGE_KB.length);
  });
});

describe("C-6: docs", () => {
  it("SOP-11b v2.6 and the program records say BUILT", () => {
    const sop = read("docs/sop/SOP-11b-creative-studio-banner-studio-scheduling.md");
    expect(sop).toContain("v2.6 = slice C-6");
    expect(sop).toContain("| 2.6 | 2026-11-11 | Slice C-6");
    expect(sop).not.toContain("plain browser box");
    expect(read("docs/sop-program/05-GAP-REGISTER.md")).toContain("C-6 BUILT (G-106, G-107).");
    expect(read("docs/sop-program/06-FIX-PHASE-PLAN.md")).toContain("Save-to-brand dialog — **BUILT (D234)**");
    expect(read("docs/sop-program/00-OWNER-REQUEST-VERBATIM.md")).toContain("### As built (slice C-6)");
  });
});
