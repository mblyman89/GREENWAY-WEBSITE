/**
 * src/lib/inventory/vendor-search-safety-core.ts  (SLICE 5B)
 *
 * PURE module — no supabase / no "server-only" — runs under
 * `npx tsx scripts/compliance/run-pure-selftests.ts`.
 *
 * ── THE BUG THIS EXISTS TO STOP ────────────────────────────────────────────
 * `resolveOrCreateVendor()` (intake-store.ts:127) walks a five-step ladder,
 * documented at intake-store.ts:109-122:
 *
 *   1. license number    2. exact ilike display_name    3. vendor_aliases
 *   4. normalized-name scan          5. AUTO-CREATE a draft vendors row
 *
 * Steps 1 and 4 fetched candidates with `.limit(2000)` and then filtered in
 * JAVASCRIPT (`rows.find(r => normalizeLicense(...) === licenseKey)`,
 * intake-store.ts:145). Two verified facts turn that into live data corruption:
 *
 *   - `vendors` holds **1,775 rows** (docs/ROADMAP_VENDORS_AND_KB_ENRICHMENT.md:30,
 *     live PostgREST count).
 *   - PostgREST caps the response at **1,000** and `.limit(2000)` cannot raise
 *     that (chunked-in.ts:13-14). No error is raised.
 *
 * So ~775 vendors were invisible to the search, and — with no `.order()` on
 * either query — WHICH 775 was arbitrary. When steps 1–4 all miss, step 5
 * **creates a brand-new draft vendor** (intake-store.ts:210-223). A vendor we
 * already had, whose row happened to sit past the cap, was therefore
 * DUPLICATED on delivery, splitting that vendor's lots, catalog drafts and
 * CCRS lineage across two ids.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 * Creating a record is destructive-by-accretion: you cannot un-create it
 * without a merge. So the create step may only run when the search that
 * justified it was COMPLETE. If the search was truncated or errored, "not
 * found" has not been established — it is unknown — and the honest response is
 * to leave `vendor_id` null (recoverable, visible, fixable) rather than to
 * fabricate a duplicate (silent, and corrupts lineage).
 *
 * This mirrors the asymmetry SLICE 4A/5A established: a read that cannot prove
 * itself never gets to drive an irreversible action.
 */

import type { ReadCompletenessVerdict } from "@/lib/supabase/read-completeness-core";

/** Evidence gathered while walking the resolution ladder. */
export type VendorSearchEvidence = {
  /** True when EVERY search step that ran read its table completely. */
  searchComplete: boolean;
  /** Whichever step first proved incomplete, for the operator-facing note. */
  incompleteStep?: string | null;
  /** The verdict from that step, when one is available. */
  verdict?: ReadCompletenessVerdict | null;
};

export type VendorCreateDecision = {
  /** May step 5 create a draft vendor row? */
  mayCreate: boolean;
  reason: "search_complete" | "search_incomplete";
  /** Operator-facing explanation. Never blank when mayCreate is false. */
  message: string;
};

/**
 * Decide whether a MISS is trustworthy enough to justify creating a vendor.
 *
 * NEVER GUESS: anything other than an explicit, complete search refuses. A
 * missing/garbage evidence object is treated as incomplete, not as permission.
 */
export function decideVendorCreate(evidence: VendorSearchEvidence | null | undefined): VendorCreateDecision {
  if (!evidence || evidence.searchComplete !== true) {
    const step = evidence?.incompleteStep ? ` (${evidence.incompleteStep})` : "";
    const detail = evidence?.verdict?.message ? ` ${evidence.verdict.message}` : "";
    return {
      mayCreate: false,
      reason: "search_incomplete",
      message:
        `Vendor search was incomplete${step}, so "no match" could not be established.${detail}` +
        " Leaving the vendor unassigned rather than creating a possible duplicate.",
    };
  }
  return {
    mayCreate: true,
    reason: "search_complete",
    message: "Vendor search read every candidate and found no match.",
  };
}

/**
 * Candidate DB filters for a license number stored as FREE-FORM text.
 *
 * `vendors.license_number` is plain `text` (migration 0064) with no normalizing
 * constraint or index, so the same license can legitimately be stored as
 * "417068", "417-068", or "417 068". The JS comparison has always been
 * digits-only (`normalizeLicense`, vendor-resolve-core.ts:49).
 *
 * A single `.eq("license_number", digits)` would therefore MISS the formatted
 * variants and QUIETLY REGRESS matching — trading a truncation bug for a
 * matching bug. That is why the caller uses these as a FAST PATH only and
 * still falls back to a complete paged scan on a miss: the fast path can only
 * ever produce a true positive, never a false negative that matters.
 *
 * Returns [] for an unusable license so the caller skips the fast path.
 */
export function licenseFilterCandidates(licenseKey: string | null | undefined): string[] {
  if (typeof licenseKey !== "string") return [];
  const digits = licenseKey.replace(/\D+/g, "");
  if (digits.length < 4) return [];
  const out = new Set<string>([digits]);
  // Common human formattings of a 6-digit WA license.
  if (digits.length === 6) {
    out.add(`${digits.slice(0, 3)}-${digits.slice(3)}`);
    out.add(`${digits.slice(0, 3)} ${digits.slice(3)}`);
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// Self-tests
// ---------------------------------------------------------------------------

export function __runVendorSearchSafetyCoreTests(): void {
  let n = 0;
  function ok(cond: boolean, label: string) {
    n++;
    if (!cond) throw new Error(`vendor-search-safety self-test failed: ${label}`);
  }

  // ── decideVendorCreate ───────────────────────────────────────────────────
  {
    const d = decideVendorCreate({ searchComplete: true });
    ok(d.mayCreate, "a complete search may create");
    ok(d.reason === "search_complete", "reason search_complete");
  }
  {
    const d = decideVendorCreate({ searchComplete: false, incompleteStep: "license lookup" });
    ok(!d.mayCreate, "an incomplete search may NOT create");
    ok(d.reason === "search_incomplete", "reason search_incomplete");
    ok(d.message.includes("license lookup"), "message names the failing step");
    ok(d.message.length > 0, "refusal is always explained");
  }
  ok(!decideVendorCreate(null).mayCreate, "null evidence refuses (never guess)");
  ok(!decideVendorCreate(undefined).mayCreate, "undefined evidence refuses");
  ok(
    !decideVendorCreate({ searchComplete: "yes" as unknown as boolean }).mayCreate,
    "a truthy non-true value is NOT permission",
  );
  {
    const d = decideVendorCreate({
      searchComplete: false,
      incompleteStep: "normalized scan",
      verdict: {
        complete: false,
        reason: "read_failed",
        rowsRead: 1000,
        missing: 775,
        message: "775 row(s) are missing.",
      },
    });
    ok(d.message.includes("775"), "verdict detail is surfaced to the operator");
  }

  // ── licenseFilterCandidates ──────────────────────────────────────────────
  {
    const c = licenseFilterCandidates("417068");
    ok(c.includes("417068"), "plain digits included");
    ok(c.includes("417-068"), "hyphenated variant included");
    ok(c.includes("417 068"), "spaced variant included");
  }
  {
    // The manifest may carry decoration; we normalize before building filters.
    const c = licenseFilterCandidates("LIC 417-068");
    ok(c.includes("417068"), "decorated input still yields the digit form");
  }
  ok(licenseFilterCandidates(null).length === 0, "null license yields no filters");
  ok(licenseFilterCandidates("12").length === 0, "too-short license yields no filters");
  ok(licenseFilterCandidates("abc").length === 0, "non-numeric yields no filters");
  {
    const c = licenseFilterCandidates("1234567");
    ok(c.length === 1 && c[0] === "1234567", "non-6-digit gets no formatted variants");
  }

  console.log(`vendor-search-safety-core self-tests: ${n} assertions passed`);
}
