/**
 * R55 — Banner Studio shapes, layers, icons, text effects (source guards).
 * The pure logic is covered by the self-tests (banner-elements-core,
 * banner-design-core); these check the wiring stays in place.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("R55-S2 shapes + layers", () => {
  const site = read("src/components/site/DesignedBanner.tsx");
  const studio = read("src/components/admin/banner-studio/BannerStudio.tsx");
  const canvas = read("src/components/admin/banner-studio/StudioCanvas.tsx");

  it("public banner draws shapes decoratively and paints layer order with z-index only", () => {
    expect(site).toContain("<ElementVisual el={el} />"); // R57: wraps <DesignShape> with motion
    expect(read("src/components/site/DesignMotion.tsx")).toContain("<DesignShape el={el} />");
    expect(site).toMatch(/aria-hidden="true"\s+style=\{css\(withZ\(elementStyle\(el\), el\.id\)\)\}/);
    expect(site).toContain("const z = layerZ(design);");
  });

  it("studio has Shapes and Layers tabs; deleting a layer also drops it from the order", () => {
    expect(studio).toContain('tabBtn("shapes"');
    expect(studio).toContain('tabBtn("layers"');
    expect(studio).toContain("design.order?.filter((id) => id !== s.id)");
  });

  it("locked items select but never drag", () => {
    expect(canvas).toContain("if (!inGroup && isLocked(target, id)) return; // R55: locked = select only");
    // R56: a group drag skips locked items inside the pure core (setPositions).
  });

  it("phone shape height uses the container rule", () => {
    expect(read("src/app/globals.css")).toContain("--gbh: var(--gmh, var(--gh));");
  });
});

describe("R55-S3 icons", () => {
  it("icon artwork is copied into the design; the public site never imports the icon set or library", () => {
    for (const f of ["src/components/site/DesignedBanner.tsx", "src/components/site/DesignShape.tsx", "src/lib/cms/banner-elements-core.ts", "src/lib/cms/banner-design-core.ts"]) {
      const src = read(f);
      expect(src, f).not.toContain("banner-icons-data");
      expect(src, f).not.toContain("@phosphor-icons");
      expect(src, f).not.toContain("banner-objects-data");
    }
    expect(read("src/components/admin/banner-studio/ShapePanel.tsx")).toContain("defaultIcon(icon, weight, path");
  });
  it("icon paths are validated to SVG path commands only", () => {
    expect(read("src/lib/cms/banner-elements-core.ts")).toContain("if (isIcon && !isSafeIconPath(raw.iconPath)) return null;");
    expect(read("src/lib/cms/banner-icons-data.ts")).toContain("Phosphor Icons (https://phosphoricons.com), MIT License");
    expect(read("src/lib/cms/banner-objects-data.ts")).toContain("Material Design Icons (https://pictogrammers.com), Apache");
  });
});

describe("R55-S4 fonts + text effects", () => {
  const loader = read("src/lib/cms/fonts-loader.ts");
  const panel = read("src/components/admin/banner-studio/TextBoxPanel.tsx");

  it("new display/script faces are not preloaded on every page", () => {
    for (const v of ["--gw-font-archivo-black", "--gw-font-lobster", "--gw-font-permanent-marker", "--gw-font-bungee"]) {
      expect(loader).toContain(v);
    }
    expect((loader.match(/preload: false/g) ?? []).length).toBe(12);
  });

  it("text box panel uses the grouped font picker + effects block", () => {
    expect(panel).toContain("<FontSelect value={box.font}");
    expect(panel).toContain("<TextFxFields box={box}");
  });
});
