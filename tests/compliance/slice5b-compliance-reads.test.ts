/**
 * tests/compliance/slice5b-compliance-reads.test.ts  (SLICE 5B)
 *
 * SLICE 5B fixes the capped reads that corrupt data or misstate compliance
 * evidence.
 *
 * THE HEADLINE BUG — vendor resolution — is not hypothetical, it is firing now:
 *   - `vendors` holds 1,775 rows (docs/ROADMAP_VENDORS_AND_KB_ENRICHMENT.md:30,
 *     a live PostgREST count);
 *   - `resolveOrCreateVendor()` steps 1 and 4 asked for `.limit(2000)`;
 *   - PostgREST returns 1,000 and raises no error (chunked-in.ts:13-14);
 *   - neither query had an `.order()`, so WHICH 1,000 was arbitrary;
 *   - when steps 1-4 miss, step 5 AUTO-CREATES a draft vendor
 *     (intake-store.ts:210-223).
 * So an existing vendor sitting past the cap was duplicated on delivery,
 * splitting its lots, catalog drafts and CCRS lineage across two ids.
 *
 * Also covered: DOH card health (patient_authorizations) and the WAC
 * 314-55-090(2) medical-exempt excise evidence, both of which silently
 * under-reported.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  decideVendorCreate,
  licenseFilterCandidates,
  __runVendorSearchSafetyCoreTests,
} from "@/lib/inventory/vendor-search-safety-core";
import { normalizeLicense, pickVendorByNormalizedName } from "@/lib/inventory/vendor-resolve-core";
import { pagedAllChecked } from "@/lib/supabase/chunked-in";

const ROOT = process.cwd();

function readCode(rel: string): string {
  const raw = readFileSync(join(ROOT, rel), "utf-8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

const SERVER_CAP = 1000;

describe("SLICE 5B — the create guard (pure)", () => {
  it("runs its embedded self-tests", () => {
    expect(() => __runVendorSearchSafetyCoreTests()).not.toThrow();
  });

  it("allows creation only after a COMPLETE search", () => {
    expect(decideVendorCreate({ searchComplete: true }).mayCreate).toBe(true);
  });

  it("REFUSES to create when the search was truncated", () => {
    // This is the whole point: a miss on an incomplete search is not a miss,
    // it is an unknown — and creating here is what duplicates a vendor.
    const d = decideVendorCreate({ searchComplete: false, incompleteStep: "license lookup" });
    expect(d.mayCreate).toBe(false);
    expect(d.message).toMatch(/incomplete/i);
  });

  it("refuses on missing evidence rather than assuming permission", () => {
    expect(decideVendorCreate(null).mayCreate).toBe(false);
    expect(decideVendorCreate(undefined).mayCreate).toBe(false);
  });

  it("does not accept a truthy non-true value as permission", () => {
    expect(
      decideVendorCreate({ searchComplete: "yes" as unknown as boolean }).mayCreate,
    ).toBe(false);
  });

  it("always explains a refusal", () => {
    const d = decideVendorCreate({ searchComplete: false });
    expect(d.message.length).toBeGreaterThan(0);
  });
});

describe("SLICE 5B — license filters do not regress matching", () => {
  it("covers the formattings free-form text allows", () => {
    // vendors.license_number is plain `text` (migration 0064) with no
    // normalizing constraint, so "417-068" is a legal way to store 417068.
    const c = licenseFilterCandidates("417068");
    expect(c).toContain("417068");
    expect(c).toContain("417-068");
    expect(c).toContain("417 068");
  });

  it("agrees with the digits-only comparison the JS path uses", () => {
    for (const variant of ["417068", "417-068", "417 068"]) {
      expect(normalizeLicense(variant)).toBe("417068");
    }
  });

  it("produces no filter for an unusable license (so the fast path is skipped)", () => {
    expect(licenseFilterCandidates(null)).toHaveLength(0);
    expect(licenseFilterCandidates("12")).toHaveLength(0);
    expect(licenseFilterCandidates("abc")).toHaveLength(0);
  });
});

describe("SLICE 5B — intake-store vendor resolution", () => {
  const code = readCode("src/lib/inventory/intake-store.ts");

  it("no longer fetches vendors with a cap-exceeding .limit()", () => {
    expect(code).not.toMatch(/\.limit\(\s*2000\s*\)/);
  });

  it("uses a targeted DB filter as a fast path", () => {
    // Downloading 1,775 rows to find one license is the wrong shape even
    // without the cap — let the server do the filtering.
    expect(code).toContain("licenseFilterCandidates");
    expect(code).toMatch(/\.in\("license_number",\s*candidates\)/);
  });

  it("falls back to a COMPLETE paged scan so matching never regresses", () => {
    // The fast path can miss an exotic formatting; the scan cannot.
    expect(code).toContain("pagedAllChecked");
    expect(code).toMatch(/normalizeLicense\(r\.license_number\) === licenseKey/);
  });

  it("orders every vendor scan by a UNIQUE column", () => {
    const orders = code.match(/\.order\("id",\s*\{\s*ascending:\s*true\s*\}\)/g) ?? [];
    expect(orders.length).toBeGreaterThanOrEqual(3);
  });

  it("GUARDS the auto-create step behind a complete search", () => {
    expect(code).toContain("decideVendorCreate");
    expect(code).toMatch(/if\s*\(!decision\.mayCreate\)/);
    expect(code).toMatch(/return null;/);
  });

  it("records which step proved incomplete", () => {
    expect(code).toContain("noteIncomplete");
    expect(code).toContain("license lookup");
    expect(code).toContain("normalized name scan");
  });

  it("treats a thrown error as an incomplete search too", () => {
    // A catch that left searchComplete true would re-open the duplicate path.
    expect(code).toMatch(/searchComplete = false;/);
  });

  it("still preserves the display_name sort the pure matcher relies on", () => {
    // pickVendorByNormalizedName returns the FIRST match, so callers must pass
    // rows in a stable order (vendor-resolve-core.ts:66-67).
    expect(code).toMatch(/localeCompare/);
    expect(code).toContain("pickVendorByNormalizedName");
  });

  it("pages the manifest stage counts", () => {
    expect(code).toContain("MANIFEST_SCAN_MAX_ROWS");
    expect(code).toContain("countStages");
  });
});

describe("SLICE 5B — the duplicate-vendor scenario, demonstrated", () => {
  /** A vendors table larger than the server cap. */
  function vendorTable(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `v-${String(i).padStart(6, "0")}`,
      license_number: `4${String(100000 + i).slice(-5)}`,
      display_name: `Vendor ${i}`,
    }));
  }

  it("PROVES the old shape lost 775 of 1,775 vendors", () => {
    const all = vendorTable(1775);
    const truncated = all.slice(0, SERVER_CAP); // what .limit(2000) really returned
    expect(truncated).toHaveLength(1000);

    // A real vendor living past the cap...
    const target = all[1500];
    // ...is invisible to the old JS filter...
    const oldHit = truncated.find(
      (r) => normalizeLicense(r.license_number) === normalizeLicense(target.license_number),
    );
    expect(oldHit).toBeUndefined(); // => step 5 creates a DUPLICATE
    // ...but present in the complete table.
    const trueHit = all.find(
      (r) => normalizeLicense(r.license_number) === normalizeLicense(target.license_number),
    );
    expect(trueHit?.id).toBe(target.id);
  });

  it("finds that same vendor once the read is paged", async () => {
    const all = vendorTable(1775);
    const { rows, verdict } = await pagedAllChecked<{ id: string; license_number: string }>(
      async (from, to) => ({
        rows: all.slice(from, to + 1).slice(0, SERVER_CAP),
        ok: true,
      }),
    );
    expect(verdict.complete).toBe(true);
    expect(rows).toHaveLength(1775);
    const target = all[1500];
    const hit = rows.find(
      (r) => normalizeLicense(r.license_number) === normalizeLicense(target.license_number),
    );
    expect(hit?.id).toBe(target.id);
  });

  it("finds a name-matched vendor past the cap too", async () => {
    const all = vendorTable(1775);
    const { rows } = await pagedAllChecked<{
      id: string;
      display_name: string;
      license_number: string;
    }>(async (from, to) => ({ rows: all.slice(from, to + 1).slice(0, SERVER_CAP), ok: true }));
    const hit = pickVendorByNormalizedName("vendor 1600", rows);
    expect(hit?.id).toBe("v-001600");
  });

  it("refuses to create when that scan could not finish", async () => {
    const all = vendorTable(1775);
    let call = 0;
    const { verdict } = await pagedAllChecked<{ id: string }>(async (from, to) => {
      call++;
      if (call === 2) return { rows: [], ok: false };
      return { rows: all.slice(from, to + 1).slice(0, SERVER_CAP), ok: true };
    });
    expect(verdict.complete).toBe(false);
    expect(decideVendorCreate({ searchComplete: verdict.complete }).mayCreate).toBe(false);
  });
});

describe("SLICE 5B — DOH medical card health", () => {
  const code = readCode("src/lib/compliance/compliance-health.ts");

  it("no longer caps the authorizations read", () => {
    expect(code).not.toMatch(/\.limit\(\s*2000\s*\)/);
  });

  it("pages with a stable unique order", () => {
    expect(code).toContain("pagedAllChecked");
    expect(code).toMatch(/\.order\("id",\s*\{\s*ascending:\s*true\s*\}\)/);
  });

  it("reports unavailable rather than a confident wrong tally", () => {
    expect(code).toMatch(/if\s*\(!verdict\.complete\)\s*return\s*\{\s*available:\s*false/);
  });

  it("still reads only active authorizations", () => {
    expect(code).toMatch(/\.eq\("status",\s*"active"\)/);
  });
});

describe("SLICE 5B — WAC 314-55-090(2) medical-exempt evidence", () => {
  const code = readCode("src/app/admin/compliance/ccrs/page.tsx");

  it("no longer sits exactly on the 1,000-row cap", () => {
    expect(code).not.toMatch(/\.limit\(\s*1000\s*\)/);
  });

  it("pages with a stable unique order", () => {
    expect(code).toContain("pagedAllChecked");
    expect(code).toMatch(/\.order\("id",\s*\{\s*ascending:\s*true\s*\}\)/);
  });

  it("keeps the sale_date window intact", () => {
    expect(code).toMatch(/\.gte\("sale_date",\s*week\.start\)/);
    expect(code).toMatch(/\.lte\("sale_date",\s*week\.end\)/);
  });

  it("WARNS the operator when the evidence count may be short", () => {
    // A wrong number nobody can see is still a wrong number. This is a
    // 5-year-retention recordkeeping duty.
    expect(code).toContain("medicalExemptComplete");
    expect(code).toMatch(/MINIMUM/);
  });

  it("treats a thrown read as incomplete", () => {
    expect(code).toMatch(/medicalExemptComplete = false;/);
  });
});
