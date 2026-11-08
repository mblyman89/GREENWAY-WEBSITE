/**
 * D213 — Vendor Menus: one business never in both tables; menus matched
 * through duplicate cards, merged cards, cleaner names, and owner links.
 * Vitest mirror of the pure self-tests plus structural locks on the store,
 * the "Link to vendor" action, and the same-license duplicate signal.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  __runVendorMenuCoverageCoreTests,
  buildSurvivorResolver,
  buildVendorMatcher,
  mergedIntoFromNotes,
  menuNameVariants,
  parseMenuLinkTargets,
  type CoverageVendor,
} from "@/lib/purchasing/vendor-menu-coverage-core";
import { findDuplicateGroups, type MergeCandidate } from "@/lib/vendors/merge-core";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const V = (id: string, name: string, extra: Partial<CoverageVendor> = {}): CoverageVendor => ({
  id,
  display_name: name,
  slug: id,
  dba: null,
  legal_name: null,
  license_number: null,
  email: null,
  phone: null,
  website: null,
  is_active: true,
  total_accepted_ytd_cents: null,
  last_accepted_at: null,
  ...extra,
});

describe("vendor-menu-coverage-core (D213)", () => {
  it("passes its own pure self-tests at the raised floor", () => {
    const r = __runVendorMenuCoverageCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThanOrEqual(140);
  });

  it("parses the merge note merge_vendors() writes", () => {
    expect(mergedIntoFromNotes('Merged into "X" (30ef7ae1-1851-463a-b121-33c60725d4f9) on 2026-07-26.')).toBe(
      "30ef7ae1-1851-463a-b121-33c60725d4f9",
    );
    expect(mergedIntoFromNotes("nothing here")).toBeNull();
  });

  it("resolves archived merged cards to the survivor", () => {
    const r = buildSurvivorResolver([V("s", "Survivor"), V("d", "Dup", { status: "archived", merged_into_id: "s" })]);
    expect(r("d")).toBe("s");
  });

  it("breaks a duplicate-license tie with the card we receive from, and says why", () => {
    const vendors = [V("a", "GREENLEAF GROWERS", { license_number: "412259" }), V("b", "Greenleaf MJ", { license_number: "412259" })];
    const m = buildVendorMatcher(vendors, [], [], { carried: new Set(["a"]) });
    const hit = m({ vendorId: null, label: "Greenleaf Growers", altLabel: null, license: "412259" });
    expect(hit.vendorId).toBe("a");
    expect(hit.detail).toMatch(/receive from/);
    expect(hit.duplicateIds).toContain("b");
  });

  it("still refuses a tie it cannot break (rule 3)", () => {
    const vendors = [V("a", "Twin Co"), V("b", "Twin Co")];
    const m = buildVendorMatcher(vendors, [], [], { carried: new Set(["a", "b"]) });
    expect(m({ vendorId: null, label: "Twin Co", altLabel: null, license: null }).how).toBe("ambiguous");
  });

  it("cleans marketing tails, asides and trademark signs", () => {
    expect(menuNameVariants("Evergreen Herbal - NEW! THC Only")).toContain("Evergreen Herbal");
    expect(menuNameVariants("Sitka Hash House\u2122")[0]).toBe("Sitka Hash House");
  });

  it("drops malformed link targets", () => {
    expect(parseMenuLinkTargets('[{"source":"cultivera","label":"A"},{"source":"x","label":"B"}]')).toEqual([
      { source: "cultivera", label: "A" },
    ]);
  });
});

describe("merge-core same-license signal (D213)", () => {
  const c = (id: string, name: string, license: string | null, status = "draft"): MergeCandidate =>
    ({ id, display_name: name, legal_name: null, license_number: license, website: null, status, product_count: 0, brand_count: 0 }) as MergeCandidate;

  it("groups live cards that share a license number, before name/website", () => {
    const groups = findDuplicateGroups([c("a", "GREENLEAF GROWERS", "412259"), c("b", "Greenleaf MJ", "412259"), c("x", "Other", "999999")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("same-license");
    expect(groups[0].vendors.map((v) => v.id).sort()).toEqual(["a", "b"]);
  });

  it("ignores archived cards for the license signal", () => {
    expect(findDuplicateGroups([c("a", "A", "412259"), c("b", "B", "412259", "archived")])).toHaveLength(0);
  });

  it("the merge page labels the new reason", () => {
    expect(read("src/app/admin/vendors/merge/page.tsx")).toContain('"same-license": "Same license number"');
  });
});

describe("structural locks (D213)", () => {
  const store = read("src/lib/purchasing/vendor-menu-coverage-store.ts");
  const link = read("src/lib/purchasing/vendor-menu-link-store.ts");
  const actions = read("src/app/admin/purchasing/menus/actions.ts");
  const page = read("src/app/admin/purchasing/menus/page.tsx");

  it("store reads merge notes + alias source_system with named columns and rolls lots to survivors", () => {
    expect(store).toContain("logo_media_id, internal_notes");
    expect(store).toContain('select("id, vendor_id, source_name, source_system")');
    expect(store).toContain("rollupLots(lots, buildSurvivorResolver(vendors))");
    expect(store).toContain("buildVendorMatcher(vendors, aliases, brands, { carried })");
    expect(store).not.toMatch(/select\("\*"\)/);
  });

  it("link store is server-only, refuses archived cards, and reads every error", () => {
    expect(link).toContain('import "server-only"');
    expect(link).toMatch(/archived/);
    expect(link).toContain("MENU_LINK_ALIAS_SYSTEM");
    const errs = link.match(/\{ (?:data: [a-zA-Z]+, )?error(?:: [a-zA-Z]+)? \}/g) ?? [];
    expect(errs.length).toBeGreaterThanOrEqual(4);
  });

  it("link action is gated, audited and revalidates", () => {
    const fn = actions.slice(actions.indexOf("export async function linkMenuToVendorAction"));
    expect(fn).toContain('requirePermission("inventory.manage")');
    expect(fn).toContain('action: "vendor.menu_linked"');
    expect(fn).toContain('revalidatePath("/admin/purchasing/menus")');
  });

  it("page shows the reason, the duplicate cards with a merge link, and Link to vendor", () => {
    expect(page).toContain("r.matchDetail");
    expect(page).toContain('href="/admin/vendors/merge"');
    expect(page).toContain("<LinkVendorButton");
    expect(page).toContain("<VendorPickList");
  });

  it("the owner request is recorded verbatim", () => {
    expect(read("docs/sop-program/00-OWNER-REQUEST-VERBATIM.md")).toContain("## D213");
  });
});
