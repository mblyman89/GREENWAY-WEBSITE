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
  MEDICAL_HERO_BLOCKS,
  MEDICAL_HERO_KEYS,
  MEDICAL_VISIBLE_VALUE,
  MEDICAL_HIDDEN_VALUE,
  isMedicalPageHidden,
  isMedicalContentBlock,
  isMedicalHeroBlock,
  medicalFallback,
  medicalHeroFallback,
  resolveMedicalValue,
  __runMedicalContentCoreTests,
} from "@/lib/medical/medical-content-core";
import {
  isSelectBlock,
  selectDefaultValue,
  resolveSelectSpec,
} from "@/lib/cms/content-select-core";
import {
  CONTENT_EDITORS,
  ownerForBlock,
  SITE_CONTENT_EXCLUDED_PAGES,
} from "@/lib/cms/content-reachability-core";

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

// ---------------------------------------------------------------------------
// MIG-5 Slice 1 (ADD) — the hero/intro copy is now editable in the Medical
// editor too (additive-first). It stays editable in Site Content until the
// SUBTRACT slice; nothing on /medical changes until a staff member Publishes.
// ---------------------------------------------------------------------------
describe("MIG-5 Slice 1 — Medical hero/intro added to the dedicated editor", () => {
  const corePath = "src/lib/medical/medical-content-core.ts";
  const seedByKey = new Map(CONTENT_BLOCK_SEEDS.map((s) => [s.block_key, s]));

  it("exposes exactly the 3 hero/intro blocks in a SEPARATE registry", () => {
    expect(MEDICAL_HERO_BLOCKS).toHaveLength(3);
    expect([...MEDICAL_HERO_KEYS].sort()).toEqual(
      ["medical.hero.subtitle", "medical.hero.title", "medical.intro.body"],
    );
  });

  it("keeps the two registries DISJOINT (no double-seed risk)", () => {
    // The 15-copy registry stays exactly 15 and excludes the hero keys.
    expect(MEDICAL_CONTENT_BLOCKS).toHaveLength(15);
    for (const k of MEDICAL_HERO_KEYS) {
      expect(isMedicalContentBlock(k)).toBe(false);
      expect(MEDICAL_CONTENT_KEYS).not.toContain(k);
    }
    for (const b of MEDICAL_CONTENT_BLOCKS) {
      expect(isMedicalHeroBlock(b.key)).toBe(false);
    }
  });

  it("hero registry does NOT feed medicalCopyBlockSeeds (each key seeded once)", () => {
    for (const k of MEDICAL_HERO_KEYS) {
      const rows = CONTENT_BLOCK_SEEDS.filter((s) => s.block_key === k);
      expect(rows).toHaveLength(1);
    }
  });

  it("every hero fallback is BYTE-IDENTICAL to its seed defaultValue", () => {
    for (const b of MEDICAL_HERO_BLOCKS) {
      const seed = seedByKey.get(b.key);
      expect(seed).toBeTruthy();
      expect(b.fallback).toBe(seed?.defaultValue);
      expect(medicalHeroFallback(b.key)).toBe(seed?.defaultValue);
    }
  });

  it("isMedicalHeroBlock recognises only the hero keys", () => {
    expect(isMedicalHeroBlock("medical.hero.title")).toBe(true);
    expect(isMedicalHeroBlock("medical.intro.body")).toBe(true);
    expect(isMedicalHeroBlock("medical.bring.title")).toBe(false);
    expect(isMedicalHeroBlock(MEDICAL_HIDE_BLOCK)).toBe(false);
    expect(isMedicalHeroBlock(null)).toBe(false);
    expect(isMedicalHeroBlock("")).toBe(false);
  });

  it("the medical editor actions now accept hero blocks", () => {
    const actions = read("src/app/admin/medical-page/actions.ts");
    expect(actions).toContain("isMedicalHeroBlock");
    // The guard OR-combines the hide block, the copy blocks, and hero blocks.
    expect(actions).toMatch(/isMedicalContentBlock\(blockKey\)\s*\|\|\s*\n?\s*isMedicalHeroBlock\(blockKey\)/);
  });

  it("the medical editor page surfaces a Hero & intro section (intro is multiline)", () => {
    const page = read("src/app/admin/medical-page/page.tsx");
    expect(page).toContain("MEDICAL_HERO_BLOCKS");
    expect(page).toContain("medicalHeroFallback");
    expect(page).toContain("Hero & intro");
    // intro.body added to the multiline set.
    expect(page).toMatch(/MULTILINE_KEYS[\s\S]*medical\.intro\.body/);
  });

  it("the pure core still passes all self-tests including the new hero asserts", () => {
    const core = read(corePath);
    expect(core).toContain("MEDICAL_HERO_BLOCKS");
    expect(core).toContain("3 hero/intro Medical blocks");
    const res = __runMedicalContentCoreTests();
    expect(res.passed).toBeGreaterThan(100);
  });
});

describe("MIG-5 Slice 2 — SUBTRACT: medical & legal removed from Site Content", () => {
  const sitePath = "src/app/admin/content/page.tsx";
  // Read ONLY the PAGE_BUILDER_PAGES Set literal body (between its `[` and `]`)
  // so an explanatory comment mentioning any page name in prose can't fool us.
  const siteSrc = read(sitePath);
  const setStart = siteSrc.indexOf("const PAGE_BUILDER_PAGES");
  const literal = siteSrc.slice(
    siteSrc.indexOf("[", setStart),
    siteSrc.indexOf("]", setStart) + 1,
  );

  it("Site Content now excludes the whole medical group (wholesale)", () => {
    expect(literal).toContain('"medical"');
  });

  it("Site Content now excludes all four legal groups (wholesale)", () => {
    expect(literal).toContain('"legal"');
    expect(literal).toContain('"legal-privacy"');
    expect(literal).toContain('"legal-terms"');
    expect(literal).toContain('"legal-chd"');
  });

  it("the Site Content filter still filters by !PAGE_BUILDER_PAGES.has(b.page)", () => {
    expect(siteSrc).toContain(
      "!PAGE_BUILDER_PAGES.has(b.page) && !EXCLUDED_KEYS.has(b.block_key)",
    );
  });

  it("the 3 medical copy blocks now resolve to the Medical page editor", () => {
    for (const key of [
      "medical.hero.title",
      "medical.hero.subtitle",
      "medical.intro.body",
    ]) {
      expect(ownerForBlock(key, "medical")).toBe(CONTENT_EDITORS.MEDICAL_PAGE);
    }
  });

  it("none of the medical/legal blocks fall back to SITE_CONTENT any more", () => {
    const cases: [string, string][] = [
      ["medical.hero.title", "medical"],
      ["medical.hero.subtitle", "medical"],
      ["medical.intro.body", "medical"],
      ["privacy.hero.title", "legal"],
      ["terms.hero.title", "legal"],
      ["chd.hero.title.line1", "legal"],
      ["chd.hero.title.line2", "legal"],
      ["privacy.body.doc", "legal-privacy"],
      ["terms.body.doc", "legal-terms"],
      ["chd.body.doc", "legal-chd"],
    ];
    for (const [key, page] of cases) {
      const owner = ownerForBlock(key, page);
      expect(owner).not.toBe(CONTENT_EDITORS.SITE_CONTENT);
      expect(owner).not.toBe(CONTENT_EDITORS.NONE);
    }
  });

  it("all five pages are in SITE_CONTENT_EXCLUDED_PAGES (mirrors the filter)", () => {
    for (const page of [
      "medical",
      "legal",
      "legal-privacy",
      "legal-terms",
      "legal-chd",
    ]) {
      expect(SITE_CONTENT_EXCLUDED_PAGES.has(page)).toBe(true);
    }
  });

  it("the website-sync medical card now points at the Medical page editor", () => {
    const sync = read("src/app/admin/website-sync/page.tsx");
    expect(sync).toContain('href="/admin/medical-page"');
    // The old Site Content link for the medical note is gone from that card.
    expect(sync).toMatch(/Medical page[\s\S]*medical\.\* blocks/);
  });
});
