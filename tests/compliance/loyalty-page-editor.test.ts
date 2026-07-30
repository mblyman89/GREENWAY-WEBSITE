/**
 * SLICE 108 — Loyalty page editor (Website → Loyalty page).
 *
 * Michael: make the FRIENDLY copy on the public /loyalty page editable (signup
 * button, birthday note, thank-you message, and the "Program terms" headings)
 * WITHOUT letting an edit change anything legal or register-truth.
 *
 * Pins:
 *   - loyalty-content-core pure logic (6 byte-identical copy blocks + resolve
 *     fallbacks) via its self-tests + targeted cases,
 *   - the 6 "plain" copy blocks are seeded LIVE-LOOK-SAFE (byte-identical to
 *     what the components ship), so /loyalty is unchanged until a staff member
 *     edits and Publishes,
 *   - the public wiring is in place: the signup form + program-terms components
 *     accept the copy props and the /loyalty page fetches + passes them,
 *   - the COMPLIANCE GUARDRAIL holds: the marketing-consent disclosure stays
 *     FIXED in the client form (not an editable block), and the program NUMBERS
 *     stay LIVE (derived from loyalty-store/program-terms-core) — no editable
 *     block references the numbers, the consent text, or the field labels,
 *   - the admin editor route/actions/nav are wired, the actions only accept the
 *     Loyalty page's own blocks, and the "Loyalty" nav item is re-pointed to
 *     the new dedicated editor.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CONTENT_BLOCK_SEEDS } from "@/lib/cms/content-blocks-seed";
import {
  LOYALTY_CONTENT_BLOCKS,
  LOYALTY_CONTENT_KEYS,
  isLoyaltyContentBlock,
  loyaltyContentFallback,
  resolveLoyaltyValue,
  __runLoyaltyContentCoreTests,
} from "@/lib/loyalty/loyalty-content-core";

const read = (p: string) => readFileSync(p, "utf8");

describe("loyalty-content-core pure logic", () => {
  it("passes its embedded self-tests", () => {
    const { passed } = __runLoyaltyContentCoreTests();
    expect(passed).toBeGreaterThan(30);
  });

  it("has 6 editable copy blocks with unique, namespaced keys + non-empty copy", () => {
    expect(LOYALTY_CONTENT_BLOCKS.length).toBe(6);
    expect(LOYALTY_CONTENT_KEYS.length).toBe(6);
    const keys = LOYALTY_CONTENT_BLOCKS.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const b of LOYALTY_CONTENT_BLOCKS) {
      expect(b.key.startsWith("loyalty.")).toBe(true);
      expect(b.fallback.trim().length).toBeGreaterThan(0);
      expect(["signup", "terms"]).toContain(b.section);
    }
    // 3 signup + 3 terms.
    expect(LOYALTY_CONTENT_BLOCKS.filter((b) => b.section === "signup").length).toBe(3);
    expect(LOYALTY_CONTENT_BLOCKS.filter((b) => b.section === "terms").length).toBe(3);
  });

  it("the pre-existing hero blocks are NOT in this registry (separate editors)", () => {
    expect(isLoyaltyContentBlock("loyalty.hero.title")).toBe(false);
    expect(isLoyaltyContentBlock("loyalty.hero.image")).toBe(false);
    expect(isLoyaltyContentBlock("loyalty.form.submit_label")).toBe(true);
    expect(isLoyaltyContentBlock("loyalty.terms.title")).toBe(true);
    expect(isLoyaltyContentBlock("")).toBe(false);
    expect(isLoyaltyContentBlock(null)).toBe(false);
  });

  it("resolve is byte-safe: blank/missing values fall back to shipped copy", () => {
    expect(resolveLoyaltyValue("loyalty.form.submit_label", null)).toBe("Sign Up");
    expect(resolveLoyaltyValue("loyalty.form.submit_label", {})).toBe("Sign Up");
    expect(
      resolveLoyaltyValue("loyalty.form.submit_label", { "loyalty.form.submit_label": "   " }),
    ).toBe("Sign Up");
    // A real edit is honoured verbatim.
    expect(
      resolveLoyaltyValue("loyalty.form.submit_label", { "loyalty.form.submit_label": "Join now" }),
    ).toBe("Join now");
  });
});

describe("seeds are live-look-safe (byte-identical)", () => {
  const byKey = new Map(CONTENT_BLOCK_SEEDS.map((s) => [s.block_key, s]));

  it("every copy block is seeded 'plain' and byte-identical to the core fallback", () => {
    for (const cb of LOYALTY_CONTENT_BLOCKS) {
      const s = byKey.get(cb.key);
      expect(s, `seed missing for ${cb.key}`).toBeTruthy();
      expect(s!.field_type).toBe("plain");
      expect(s!.page).toBe("loyalty");
      expect(s!.defaultValue).toBe(cb.fallback);
      expect(s!.defaultValue).toBe(loyaltyContentFallback(cb.key));
    }
  });

  it("the pre-existing 4 loyalty.hero.* blocks are untouched (still 10 loyalty blocks total)", () => {
    const loyalty = CONTENT_BLOCK_SEEDS.filter((s) => s.block_key.startsWith("loyalty."));
    expect(loyalty.length).toBe(10); // 4 hero + 6 new copy blocks
    expect(byKey.has("loyalty.hero.title")).toBe(true);
    expect(byKey.has("loyalty.hero.subtitle")).toBe(true);
  });

  it("all content block keys remain unique across the whole seed", () => {
    const keys = CONTENT_BLOCK_SEEDS.map((s) => s.block_key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("public wiring is in place", () => {
  const form = read("src/components/loyalty/LoyaltySignupForm.tsx");
  const terms = read("src/components/loyalty/LoyaltyProgramTerms.tsx");
  const route = read("src/app/loyalty/page.tsx");

  it("the signup form accepts + renders the friendly copy props with fallbacks", () => {
    expect(form).toContain("birthdayHelp");
    expect(form).toContain("submitLabel");
    expect(form).toContain("successTitle");
    // Byte-identical fallbacks kept inline.
    expect(form).toContain('|| "Sign Up"');
    expect(form).toContain('|| "Get special discounts and offers on your birthday!"');
  });

  it("the program-terms component accepts the heading copy with fallbacks", () => {
    expect(terms).toContain("copy?.eyebrow");
    expect(terms).toContain("copy?.title");
    expect(terms).toContain("copy?.tiersHeading");
    expect(terms).toContain('|| "How Greenway Points work"');
    expect(terms).toContain('|| "Program terms"');
    expect(terms).toContain('|| "Member tiers"');
  });

  it("the /loyalty page fetches all editable keys and passes copy down", () => {
    expect(route).toContain("LOYALTY_CONTENT_KEYS");
    expect(route).toContain("resolveLoyaltyValue");
    // Rendered on demand (like /specials and /medical) so a published edit or a
    // program-number change shows on the next load.
    expect(route).toMatch(/export const dynamic = "force-dynamic"/);
    expect(route).toContain("birthdayHelp:");
    expect(route).toContain("submitLabel:");
    expect(route).toContain("successTitle:");
    expect(route).toContain("eyebrow:");
    expect(route).toContain("tiersHeading:");
  });
});

describe("compliance guardrail holds", () => {
  const form = read("src/components/loyalty/LoyaltySignupForm.tsx");
  const terms = read("src/components/loyalty/LoyaltyProgramTerms.tsx");

  it("the marketing-consent disclosure stays FIXED (not an editable block)", () => {
    // The legal consent text is a literal const in the client component.
    expect(form).toContain("const consentText =");
    expect(form).toContain('replying \\"STOP\\"');
    expect(form).toContain("Consent is not a condition of purchase");
    // No editable copy block targets the consent disclosure or the form field
    // labels — the registry only covers the friendly helper/button/thank-you +
    // terms headings. (The submit-button block legitimately ends in
    // "submit_label"; what we forbid is a block for the consent text or the
    // input field labels.)
    for (const cb of LOYALTY_CONTENT_BLOCKS) {
      expect(cb.key).not.toContain("consent");
      expect(cb.key).not.toContain("field_label");
      expect(cb.key).not.toContain("firstName");
      expect(cb.key).not.toContain("email");
    }
  });

  it("the program numbers stay LIVE (derived from the register), not editable text", () => {
    // The terms card renders numbers from the passed-in live summary/tiers.
    expect(terms).toContain("terms.earnLine");
    expect(terms).toContain("terms.valueLine");
    expect(terms).toContain("terms.redeemLine");
    expect(terms).toContain("tiers.map");
    // The register-mechanics paragraph stays fixed literal copy.
    expect(terms).toContain("Discounts never stack");
    // No editable block key touches the numbers.
    for (const cb of LOYALTY_CONTENT_BLOCKS) {
      expect(cb.key).not.toContain("points");
      expect(cb.key).not.toContain("tier.");
      expect(cb.key).not.toContain("earn");
      expect(cb.key).not.toContain("redeem");
    }
  });
});

describe("admin editor is wired", () => {
  const actions = read("src/app/admin/loyalty-page/actions.ts");
  const page = read("src/app/admin/loyalty-page/page.tsx");
  const editor = read("src/components/admin/LoyaltyPageEditor.tsx");
  const nav = read("src/components/admin/admin-nav-data.ts");

  it("actions are use-server, reuse the content store, and only accept loyalty blocks", () => {
    expect(actions.startsWith('"use server"')).toBe(true);
    expect(actions).toContain("saveContentDraft");
    expect(actions).toContain("publishContentBlock");
    expect(actions).toContain("restoreContentRevisionToDraft");
    expect(actions).toContain("isLoyaltyContentBlock");
    // Publishing revalidates the public route + admin page.
    expect(actions).toContain('revalidatePath("/loyalty")');
    expect(actions).toContain('revalidatePath("/admin/loyalty-page")');
  });

  it("the admin page is gated on content.edit + force-dynamic and shows live numbers read-only", () => {
    expect(page).toContain('requirePermission("content.edit")');
    expect(page).toMatch(/export const dynamic = "force-dynamic"/);
    expect(page).toContain("ensureContentBlocksSeeded");
    // Live numbers snapshot comes from the same store the register uses.
    expect(page).toContain("getConfig()");
    expect(page).toContain("listTiers()");
    expect(page).toContain("loyaltyTermsSummary");
  });

  it("the editor labels the numbers as live + read-only (never editable)", () => {
    expect(editor).toContain("The program numbers shown on this page are live");
    expect(editor).toContain("CRM"); // deep link to where the numbers are actually set
  });

  it("the nav 'Loyalty' item is re-pointed to /admin/loyalty-page", () => {
    expect(nav).toContain('href: "/admin/loyalty-page"');
    // The generic /admin/pages/loyalty is no longer the primary Loyalty target.
    expect(nav).not.toContain('label: "Loyalty", href: "/admin/pages/loyalty"');
    // Distinct staff tools remain their own items.
    expect(nav).toContain('href: "/admin/loyalty"'); // CRM → Loyalty Program
    expect(nav).toContain('href: "/admin/loyalty-signups"');
  });
});
