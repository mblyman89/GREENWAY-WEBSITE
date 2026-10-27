/**
 * tests/compliance/r41-type-cards.test.ts — R41 S3 Home Type Cards.
 *
 * Drift guard: type-cards-core keeps a COPY of the six category lanes so it
 * stays free of the specials module graph. If daily-deal-presentation's
 * categoryLanes ever changes, this test fails until the copy is updated.
 * Plus source locks so the editor/action/render wiring cannot silently regress.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { categoryLanes } from "@/lib/specials/daily-deal-presentation";
import {
  DEFAULT_TYPE_LANES,
  __runTypeCardsTests,
  typeCardGridClass,
} from "@/lib/cms/type-cards-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("R41 S3 Type Cards", () => {
  it("default lanes copy matches categoryLanes exactly", () => {
    expect(DEFAULT_TYPE_LANES).toEqual(
      categoryLanes.map((l) => ({ key: l.key, label: l.label, href: l.href })),
    );
  });

  it("pure self-tests pass", () => {
    const r = __runTypeCardsTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(42);
  });

  it("six cards keep the shipped grid class string", () => {
    expect(typeCardGridClass(6)).toBe(
      "grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-6",
    );
  });

  it("PromoGrid renders typeCards with a classic fallback and hides an empty grid", () => {
    const src = read("src/components/home/PromoGrid.tsx");
    expect(src).toContain("typeCards?: TypeCard[]");
    expect(src).toContain("typeCards ??");
    expect(src).toContain("tiles.length > 0 ?");
    expect(src).toContain("typeCardGridClass(tiles.length)");
    expect(src).toContain("{lane.cta}");
  });

  it("home page passes typeCards only when the owner saved a custom list", () => {
    const src = read("src/app/(site)/page.tsx");
    expect(src).toContain("hasCustomTypeCards(category?.settings)");
    expect(src).toContain("visibleTypeCards(readTypeCards(category?.settings))");
    expect(src).toContain("typeCards={typeCards}");
  });

  it("save action re-normalizes the posted JSON and mirrors laneImages", () => {
    const src = read("src/app/admin/pages/[slug]/actions.ts");
    expect(src).toContain('formData.get("type_cards_json")');
    expect(src).toContain("normalizeTypeCards(parsed)");
    expect(src).toContain("laneImagesFromCards(typeCards)");
    expect(src).toContain('action: "page_section.type_cards"');
    // legacy fallback kept
    expect(src).toContain("lane_image_${lane}");
  });

  it("editor offers rename, link picker, add (capped), delete confirm, reset, reorder", () => {
    const src = read("src/components/admin/TypeCardImagesEditor.tsx");
    expect(src).toContain('name="type_cards_json"');
    expect(src).toContain("<LinkPicker");
    expect(src).toContain("disabled={cards.length >= MAX_TYPE_CARDS}");
    expect(src).toContain("Reset to the original six");
    expect(src).toContain("Delete card");
    expect(src).toContain("<ConfirmDialog");
    // R63: reorder / show / edit rows come from the ONE shared card-editor shell.
    expect(src).toContain("<CardEditorShell");
    const shell = read("src/components/admin/banner-studio/CardEditorShell.tsx");
    expect(shell).toMatch(/aria-label=\{`Move \$\{it\.name \|\| "card"\} up`\}/);
    expect(shell).toContain("overflow-x-auto");
    expect(src).not.toContain("defaultOpen");
  });
});
