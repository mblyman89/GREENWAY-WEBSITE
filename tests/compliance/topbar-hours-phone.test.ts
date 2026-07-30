/**
 * SLICE 105 — editable top-bar (SecondaryBar) hours size + phone overlay text.
 *
 * Michael: let me increase the font size of the store hours in the top green
 * bar, and let me edit the phone-number TEXT the customer sees (the dialed
 * number never changes). Do it safely — don't break anything.
 *
 * Pins:
 *   - a new "select" field type (no migration; field_type is plain text),
 *   - the two new header-footer blocks (hours size + phone display text),
 *   - the pure size resolver falls back safely to "normal",
 *   - SecondaryBar resolves both blocks draft-aware with live fallbacks,
 *   - the dialed tel: number is NOT driven by the editable overlay.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CONTENT_BLOCK_SEEDS } from "@/lib/cms/content-blocks-seed";
import {
  HOURS_SIZE_OPTIONS,
  __runContentSelectCoreTests,
  isSelectBlock,
  resolveSelectSpec,
  selectClassName,
  selectDefaultValue,
} from "@/lib/cms/content-select-core";

describe("content-select-core", () => {
  it("passes its full self-test suite", () => {
    const { passed } = __runContentSelectCoreTests();
    expect(passed).toBeGreaterThan(0);
  });

  it("hours size has 4 named options, first = normal (default)", () => {
    expect(HOURS_SIZE_OPTIONS).toHaveLength(4);
    expect(HOURS_SIZE_OPTIONS[0].value).toBe("normal");
    expect(selectDefaultValue("header.hours.size")).toBe("normal");
    expect(isSelectBlock("header.hours.size")).toBe(true);
    expect(resolveSelectSpec("header.hours.size")?.options).toHaveLength(4);
  });

  it("blank/unknown value resolves to the safe default class (never broken)", () => {
    const normal = selectClassName("header.hours.size", "normal");
    expect(selectClassName("header.hours.size", "")).toBe(normal);
    expect(selectClassName("header.hours.size", "bogus")).toBe(normal);
    expect(selectClassName("header.hours.size", null)).toBe(normal);
    // larger sizes map to distinct classes
    expect(selectClassName("header.hours.size", "large")).not.toBe(normal);
  });
});

describe("SLICE 105 — top-bar content blocks", () => {
  const byKey = new Map(CONTENT_BLOCK_SEEDS.map((s) => [s.block_key, s]));

  it("adds the two top-bar blocks on the header-footer page", () => {
    expect(byKey.get("header.hours.size")?.page).toBe("header-footer");
    expect(byKey.get("header.phone.display")?.page).toBe("header-footer");
  });

  it("hours size is a 'select' block seeded blank (safe default)", () => {
    expect(byKey.get("header.hours.size")?.field_type).toBe("select");
    expect(byKey.get("header.hours.size")?.defaultValue).toBe("");
  });

  it("phone display seeds the exact live overlay text", () => {
    expect(byKey.get("header.phone.display")?.field_type).toBe("plain");
    expect(byKey.get("header.phone.display")?.defaultValue).toBe("360-BUY-WEED");
  });
});

describe("SLICE 105 — SecondaryBar render wiring", () => {
  const bar = readFileSync("src/components/site/SecondaryBar.tsx", "utf8");

  it("resolves both top-bar blocks draft-aware", () => {
    expect(bar).toContain("getContentValues");
    expect(bar).toContain("header.hours.size");
    expect(bar).toContain("header.phone.display");
    expect(bar).toContain("export async function SecondaryBar()");
  });

  it("applies the resolved size class to BOTH mobile + desktop hours", () => {
    expect(bar).toContain("selectClassName");
    // used twice (mobile stacked hours + desktop one-line hours)
    expect(bar.split("hoursSizeClass").length - 1).toBeGreaterThanOrEqual(3);
  });

  it("the DIALED number stays business.ts tel; only the overlay text is editable", () => {
    expect(bar).toContain("tel:${greenwayBusiness.phone.tel}");
    expect(bar).toContain("phoneText");
    expect(bar).toContain("greenwayBusiness.phone.display");
  });
});

describe("SLICE 105 — 'select' field type wiring", () => {
  const types = readFileSync("src/lib/cms/types.ts", "utf8");
  const editor = readFileSync("src/components/admin/ContentBlockEditor.tsx", "utf8");
  const field = readFileSync("src/components/admin/ContentSelectField.tsx", "utf8");

  it("'select' is a valid ContentFieldType", () => {
    expect(types).toContain('| "select"');
  });

  it("the block editor renders ContentSelectField for select blocks", () => {
    expect(editor).toContain("ContentSelectField");
    expect(editor).toContain('block.field_type === "select"');
    // character-count + AI panel suppressed for select
    expect(editor).toContain("!isSelect");
  });

  it("ContentSelectField is a dropdown, not free text", () => {
    expect(field).toContain('"use client"');
    expect(field).toContain("<select");
    expect(field).toContain("resolveSelectSpec");
  });
});
