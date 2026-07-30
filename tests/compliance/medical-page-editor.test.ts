/**
 * SLICE 107 — Medical page editor (Website → Medical page).
 *
 * Michael: make the public /medical page editable (section headings + the two
 * info lists) AND add a page-level "hide this page" switch that removes the
 * page and its menu link — WITHOUT letting an edit break Washington compliance.
 *
 * Pins:
 *   - medical-content-core pure logic (hide switch default = Visible, only the
 *     exact "yes" hides; byte-identical copy registry + resolve fallbacks) via
 *     its self-tests + targeted cases,
 *   - the new "select" hide block + the 15 "plain" copy blocks are seeded
 *     LIVE-LOOK-SAFE (byte-identical to what MedicalProgramContent ships), so
 *     /medical is unchanged until a staff member edits and Publishes,
 *   - the hide switch is a real select block in content-select-core (default
 *     "no" = Visible), so a blank/unseeded value can never hide the page,
 *   - the public wiring is in place: MedicalProgramContent reads the blocks via
 *     <SiteText>, Header reads the flag and passes hideMedical to BOTH menus,
 *     both menus filter the Medical link, and /medical guards with notFound(),
 *   - the COMPLIANCE GUARDRAIL holds: the purchase-limit table stays LIVE from
 *     the compliance core and the statutory fine print stays FIXED in the
 *     component (not editable) — an edit can never overpromise or drift the
 *     legal figures,
 *   - the admin editor route/actions/nav are wired and the actions only accept
 *     the Medical page's own blocks.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CONTENT_BLOCK_SEEDS } from "@/lib/cms/content-blocks-seed";
import {
  MEDICAL_HIDE_BLOCK,
  MEDICAL_HIDE_OPTIONS,
  MEDICAL_CONTENT_BLOCKS,
  MEDICAL_CONTENT_KEYS,
  MEDICAL_VISIBLE_VALUE,
  MEDICAL_HIDDEN_VALUE,
  isMedicalPageHidden,
  isMedicalContentBlock,
  medicalFallback,
  resolveMedicalValue,
  __runMedicalContentCoreTests,
} from "@/lib/medical/medical-content-core";
import {
  isSelectBlock,
  selectDefaultValue,
  resolveSelectSpec,
} from "@/lib/cms/content-select-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("medical-content-core pure logic", () => {
  it("passes its embedded self-tests", () => {
    const { passed } = __runMedicalContentCoreTests();
    expect(passed).toBeGreaterThan(30);
  });

  it("hide switch defaults to Visible; only the exact 'yes' hides", () => {
    expect(MEDICAL_VISIBLE_VALUE).toBe("no");
    expect(MEDICAL_HIDDEN_VALUE).toBe("yes");
    expect(MEDICAL_HIDE_OPTIONS[0].value).toBe("no"); // first = default
    expect(isMedicalPageHidden("yes")).toBe(true);
    expect(isMedicalPageHidden("  yes  ")).toBe(true);
    expect(isMedicalPageHidden("no")).toBe(false);
    expect(isMedicalPageHidden("")).toBe(false);
    expect(isMedicalPageHidden(null)).toBe(false);
    expect(isMedicalPageHidden(undefined)).toBe(false);
    expect(isMedicalPageHidden("YES")).toBe(false); // case-sensitive, safe
    expect(isMedicalPageHidden("hidden")).toBe(false); // unknown -> visible
  });

  it("has 15 editable copy blocks with unique, namespaced keys + non-empty copy", () => {
    expect(MEDICAL_CONTENT_BLOCKS.length).toBe(15);
    expect(MEDICAL_CONTENT_KEYS.length).toBe(15);
    const keys = MEDICAL_CONTENT_BLOCKS.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const b of MEDICAL_CONTENT_BLOCKS) {
      expect(b.key.startsWith("medical.")).toBe(true);
      expect(b.fallback.trim().length).toBeGreaterThan(0);
    }
    // The hide block is NOT one of the copy blocks (different editor field).
    expect(isMedicalContentBlock(MEDICAL_HIDE_BLOCK)).toBe(false);
  });

  it("resolve is byte-safe: blank/missing values fall back to shipped copy", () => {
    expect(resolveMedicalValue("medical.bring.title", null)).toBe("What to bring");
    expect(resolveMedicalValue("medical.bring.title", {})).toBe("What to bring");
    expect(
      resolveMedicalValue("medical.bring.title", { "medical.bring.title": "   " }),
    ).toBe("What to bring");
    // A real edit is honoured verbatim.
    expect(
      resolveMedicalValue("medical.bring.title", { "medical.bring.title": "Bring this" }),
    ).toBe("Bring this");
  });
});

describe("hide switch is a proper select block", () => {
  it("is registered in content-select-core, default 'no' (Visible)", () => {
    expect(isSelectBlock(MEDICAL_HIDE_BLOCK)).toBe(true);
    expect(selectDefaultValue(MEDICAL_HIDE_BLOCK)).toBe("no");
    const spec = resolveSelectSpec(MEDICAL_HIDE_BLOCK);
    expect(spec?.options.map((o) => o.value)).toEqual(["no", "yes"]);
  });
});

describe("seeds are live-look-safe (byte-identical)", () => {
  const byKey = new Map(CONTENT_BLOCK_SEEDS.map((s) => [s.block_key, s]));

  it("the hide block is seeded as a select defaulting to Visible", () => {
    const s = byKey.get(MEDICAL_HIDE_BLOCK);
    expect(s).toBeTruthy();
    expect(s!.field_type).toBe("select");
    expect(s!.defaultValue).toBe("no");
    expect(s!.page).toBe("medical");
  });

  it("every copy block is seeded 'plain' and byte-identical to the core fallback", () => {
    for (const cb of MEDICAL_CONTENT_BLOCKS) {
      const s = byKey.get(cb.key);
      expect(s, `seed missing for ${cb.key}`).toBeTruthy();
      expect(s!.field_type).toBe("plain");
      expect(s!.defaultValue).toBe(cb.fallback);
      expect(s!.defaultValue).toBe(medicalFallback(cb.key));
    }
  });

  it("all content block keys remain unique across the whole seed", () => {
    const keys = CONTENT_BLOCK_SEEDS.map((s) => s.block_key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("public wiring is in place", () => {
  const content = read("src/components/medical/MedicalProgramContent.tsx");
  const header = read("src/components/site/Header.tsx");
  const desktop = read("src/components/site/DesktopMenu.tsx");
  const mobile = read("src/components/site/MobileNavigation.tsx");
  const route = read("src/app/medical/page.tsx");

  it("MedicalProgramContent renders every editable block via SiteText", () => {
    for (const cb of MEDICAL_CONTENT_BLOCKS) {
      expect(content.includes(cb.key), `component missing ${cb.key}`).toBe(true);
    }
  });

  it("Header is async, reads the flag, and passes hideMedical to BOTH menus", () => {
    expect(header).toMatch(/export async function Header/);
    expect(header).toContain("isMedicalPageHidden");
    expect(header).toContain("MEDICAL_HIDE_BLOCK");
    expect(header).toContain("<DesktopMenu hideMedical={medicalHidden} />");
    expect(header).toContain("<MobileNavigation hideMedical={medicalHidden} />");
  });

  it("both menus filter out the Medical link by href when hidden", () => {
    expect(desktop).toContain('item.href !== "/medical"');
    expect(mobile).toContain('item.href !== "/medical"');
    // Default false everywhere -> link shows unless explicitly hidden.
    expect(desktop).toContain("hideMedical = false");
    expect(mobile).toContain("hideMedical = false");
  });

  it("the /medical route guards with notFound() and is force-dynamic", () => {
    expect(route).toMatch(/export const dynamic = "force-dynamic"/);
    expect(route).toContain("notFound()");
    expect(route).toContain("isMedicalPageHidden");
    expect(route).toMatch(/export default async function MedicalPage/);
  });
});

describe("compliance guardrail holds", () => {
  const content = read("src/components/medical/MedicalProgramContent.tsx");

  it("the purchase-limit TABLE stays live from the compliance core", () => {
    expect(content).toContain('from "@/lib/medical/purchase-limit-display-core"');
    expect(content).toContain("purchaseLimitRows()");
    // The table body is rendered from the live rows, not editable blocks.
    expect(content).toContain("limitRows.map");
  });

  it("the statutory fine print stays FIXED (not an editable block)", () => {
    // Legal citations are present as literal fixed copy in the component.
    expect(content).toContain("WAC 314-55-095");
    expect(content).toContain("RCW 82.08.9998");
    expect(content).toContain("chapter 246-70 WAC");
    // None of the editable copy keys reference the statutory paragraphs — the
    // registry only covers eyebrows, titles, and the info bullets.
    for (const cb of MEDICAL_CONTENT_BLOCKS) {
      expect(cb.key).not.toContain("finePrint");
      expect(cb.key).not.toContain("statute");
    }
  });
});

describe("admin editor is wired", () => {
  const actions = read("src/app/admin/medical-page/actions.ts");
  const page = read("src/app/admin/medical-page/page.tsx");
  const nav = read("src/components/admin/admin-nav-data.ts");

  it("actions are use-server, reuse the content store, and only accept medical blocks", () => {
    expect(actions.startsWith('"use server"')).toBe(true);
    expect(actions).toContain("saveContentDraft");
    expect(actions).toContain("publishContentBlock");
    expect(actions).toContain("restoreContentRevisionToDraft");
    expect(actions).toContain("isEditableMedicalBlock");
    // Publishing revalidates the public route + layout (nav) + admin page.
    expect(actions).toContain('revalidatePath("/medical")');
    expect(actions).toContain('revalidatePath("/", "layout")');
  });

  it("the admin page is gated on content.edit + force-dynamic", () => {
    expect(page).toContain('requirePermission("content.edit")');
    expect(page).toMatch(/export const dynamic = "force-dynamic"/);
    expect(page).toContain("ensureContentBlocksSeeded");
  });

  it("the nav item points to /admin/medical-page (distinct from patient intake)", () => {
    expect(nav).toContain('href: "/admin/medical-page"');
    // The patient-intake tool remains a separate item.
    expect(nav).toContain('href: "/admin/medical"');
  });
});
