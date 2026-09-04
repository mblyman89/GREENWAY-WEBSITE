/**
 * src/lib/inventory/classification-mirror-core.ts   (SLICE 18E)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS ANSWERS
 *
 * When a human approves a received product at Product Onboarding and answers
 * the compliance questions, WHAT — if anything — should be written back onto
 * the `inventory_lots` row that product came from?
 *
 * This module is the policy. It does no I/O: it takes the approver's validated
 * picks plus the lot link and returns either "write exactly this" or "write
 * nothing, and here is why". The store calls it and obeys.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS EXISTS TO CLOSE (18E, "Defect 1")
 *
 * SLICE 18-0 built the receiving classification gate. On approval it writes the
 * answers to `catalog_product_drafts.chosen_*` (catalog-drafts.ts) and, via the
 * staging path, on to `menu_items` — the surface the register enforces from.
 *
 * It never wrote them back to `inventory_lots`. The receiving insert
 * (intake-store.ts:562-565) sets all four columns from the parser, and a WA
 * manifest has no such field, so they are ALWAYS null on arrival. The real
 * answer arrives later, at onboarding — and stopped there.
 *
 * That leaves the receiving dock permanently unable to tell "nobody has looked
 * at this yet" from "a human answered no last Tuesday". The dock summary reads
 * `otherwise_taken` for exactly that purpose (intake-store.ts:1470) and warns
 * only when it is null (intake-review-core.ts:158). Since it could never stop
 * being null, the suppository warning could never be silenced — on the very
 * product a human had already classified.
 *
 * That is warning fatigue, and warning fatigue is not cosmetic. The comment at
 * intake-review-core.ts:156 says it plainly: "nagging them again is how a
 * checklist becomes noise people stop reading." A compliance checklist people
 * scroll past is worse than no checklist, because it looks like coverage.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY `false` IS A VALUE HERE, NOT AN ABSENCE
 *
 * This is the single most load-bearing decision in the file.
 *
 * For `otherwise_taken` the three states are genuinely different:
 *
 *   null  — nobody has answered. The dock SHOULD nag.
 *   false — a human considered it and said "no, it is not a suppository".
 *           The dock must go quiet.
 *   true  — a human said yes. The ten-unit limit engages.
 *
 * So a mirror that skipped `false` because it looks falsy would leave the row
 * at null and fix nothing at all. `otherwise_taken` is therefore mirrored on
 * EVERY approval, matching what catalog-drafts.ts already does for
 * `chosen_otherwise_taken` (":624-631" — "written on EVERY approval, not only
 * when a human answered").
 *
 * The low-THC pair is the opposite case and is deliberately treated the
 * opposite way. There, silence is safe: an unclassified liquid simply keeps the
 * TIGHTER 72 oz limit rather than the 200 mg carve-out, so writing a `false`
 * nobody said would be inventing a claim to no benefit. Those two columns are
 * mirrored only when the approver actually answered — again matching
 * catalog-drafts.ts:635-638.
 *
 * The asymmetry is not an inconsistency. It follows the direction each
 * fail-safe points, which is the only principle that keeps both honest.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MIRROR IS NOT
 *
 * It is NOT enforcement, and nothing here may ever become enforcement.
 * Migration 0219 states the doctrine on the columns themselves:
 *
 *        ENFORCEMENT READS MENU. PROVENANCE READS LOT. NEVER THE REVERSE.
 *
 * The register reads the four flags off `menu_items` (live-menu.ts:94-100) and
 * never off a lot. So this write changes NOTHING at the point of sale, and the
 * caller must never treat its success as evidence that a limit is in force, nor
 * its failure as evidence that one is not. The menu write is the real one and
 * happens first; this is the paper trail behind it.
 *
 * PURE: no I/O, no Supabase, no clock, no randomness.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The approver's validated compliance picks, exactly as
 * validateReceivingClassificationChoice() returns them.
 */
export type MirrorClassificationInput = {
  /** The lot this draft was created from, or null when the draft has no lot. */
  lotId: string | null;
  /**
   * The human's answer. `false` is a real answer ("no, not a suppository") and
   * is always mirrored; see the header.
   */
  otherwiseTaken: boolean;
  /** Units in one sellable package, or null when not applicable/unanswered. */
  unitsPerPackage: number | null;
  /** Low-THC carve-out answer, or null when the approver did not answer. */
  lowThcLiquid: boolean | null;
  /** Per-unit mg, or null when the approver did not answer. */
  unitThcMg: number | null;
};

/** The column patch to apply to `inventory_lots`, or the reason not to. */
export type MirrorClassificationPlan =
  | {
      write: true;
      lotId: string;
      /**
       * The exact column patch. Snake-case because it is a database patch, and
       * writing it in the caller's shape is what lets a test assert the real
       * thing rather than a paraphrase of it.
       */
      patch: {
        otherwise_taken: boolean;
        units_per_package?: number;
        low_thc_liquid?: boolean;
        unit_thc_mg?: number;
      };
    }
  | {
      write: false;
      /** Machine-readable reason, for diagnostics and tests. */
      code: "no_lot_link";
      /** A sentence a human can act on. */
      reason: string;
    };

/**
 * Decide what to mirror onto the lot row.
 *
 * Returns `write: false` only when there is no lot to write to. A draft can
 * legitimately have no `lot_id` (it was created by hand rather than from a
 * received line), and that is not an error — it is simply nothing to do. The
 * caller records the reason and carries on; it must never fail the approval
 * over it, because the enforcement write has already succeeded by then.
 */
export function planClassificationMirror(
  input: MirrorClassificationInput,
): MirrorClassificationPlan {
  const lotId = (input.lotId ?? "").trim();
  if (!lotId) {
    return {
      write: false,
      code: "no_lot_link",
      reason:
        "This product isn't linked to a received lot, so there's no lot row to record the " +
        "classification against. The classification itself is already saved on the menu, " +
        "which is what the register enforces from.",
    };
  }

  // `otherwise_taken` ALWAYS. See the header: `false` is an answer, and it is
  // the answer that silences the receiving dock's suppository warning.
  const patch: {
    otherwise_taken: boolean;
    units_per_package?: number;
    low_thc_liquid?: boolean;
    unit_thc_mg?: number;
  } = { otherwise_taken: input.otherwiseTaken };

  // The count only when there is one. A null here would ERASE a count the
  // receiving paperwork already carried, and the gate guarantees a count
  // whenever otherwiseTaken is true, so omitting null can never leave a
  // flagged product without its divisor.
  if (input.unitsPerPackage !== null) {
    patch.units_per_package = input.unitsPerPackage;
  }

  // The low-THC pair only when answered — silence keeps the tighter limit.
  if (input.lowThcLiquid !== null) {
    patch.low_thc_liquid = input.lowThcLiquid;
  }
  if (input.unitThcMg !== null) {
    patch.unit_thc_mg = input.unitThcMg;
  }

  return { write: true, lotId, patch };
}

// ---------------------------------------------------------------------------
// Self-tests (registered in scripts/compliance/run-pure-selftests.ts)
// ---------------------------------------------------------------------------

export function __runClassificationMirrorTests(): { passed: number } {
  let failures = 0;
  let passed = 0;
  const ok = (cond: boolean, msg: string) => {
    if (cond) {
      passed += 1;
    } else {
      failures += 1;
      console.error(`  CLASSIFICATION-MIRROR FAIL: ${msg}`);
    }
  };

  const base: MirrorClassificationInput = {
    lotId: "lot-1",
    otherwiseTaken: false,
    unitsPerPackage: null,
    lowThcLiquid: null,
    unitThcMg: null,
  };

  // --- the defect this module exists to close ------------------------------
  // A human answering "no" MUST reach the lot row, or the dock nags forever.
  {
    const p = planClassificationMirror({ ...base, otherwiseTaken: false });
    ok(p.write === true, "a false answer must still be written");
    if (p.write) {
      ok(
        p.patch.otherwise_taken === false,
        "otherwise_taken must be the literal false, not omitted",
      );
      ok(
        "otherwise_taken" in p.patch,
        "otherwise_taken must be PRESENT in the patch when false",
      );
    }
  }

  // A "yes" carries its count.
  {
    const p = planClassificationMirror({
      ...base,
      otherwiseTaken: true,
      unitsPerPackage: 6,
    });
    ok(p.write === true, "a yes answer is written");
    if (p.write) {
      ok(p.patch.otherwise_taken === true, "otherwise_taken true survives");
      ok(p.patch.units_per_package === 6, "the box of six keeps its count");
    }
  }

  // --- the asymmetry, asserted in both directions --------------------------
  // Unanswered low-THC is OMITTED (silence keeps the tighter limit)...
  {
    const p = planClassificationMirror(base);
    if (p.write) {
      ok(
        !("low_thc_liquid" in p.patch),
        "an unanswered low-THC question must not invent a false",
      );
      ok(!("unit_thc_mg" in p.patch), "an unanswered mg must not be written");
      ok(
        !("units_per_package" in p.patch),
        "a null count must be omitted, never written as null (it would erase)",
      );
    }
  }
  // ...but an ANSWERED false is written, because it was answered.
  {
    const p = planClassificationMirror({
      ...base,
      lowThcLiquid: false,
      unitThcMg: 2,
    });
    if (p.write) {
      ok(
        p.patch.low_thc_liquid === false,
        "an answered low-THC 'no' IS written (it is an answer, not silence)",
      );
      ok(p.patch.unit_thc_mg === 2, "the answered mg is written");
    }
  }

  // --- no lot to write to ---------------------------------------------------
  for (const empty of [null, "", "   "]) {
    const p = planClassificationMirror({ ...base, lotId: empty });
    ok(p.write === false, `lotId ${JSON.stringify(empty)} must not produce a write`);
    if (!p.write) {
      ok(p.code === "no_lot_link", "the reason is machine-readable");
      ok(p.reason.length > 40, "the reason is a sentence a human can act on");
    }
  }

  // --- the patch never contains a null -------------------------------------
  // A null in a patch is an ERASURE. This asserts the shape directly rather
  // than trusting the branches above to have covered every combination.
  {
    const combos: MirrorClassificationInput[] = [
      base,
      { ...base, otherwiseTaken: true, unitsPerPackage: 2 },
      { ...base, lowThcLiquid: true, unitThcMg: 4 },
      { ...base, lowThcLiquid: false },
      { ...base, unitsPerPackage: 3 },
    ];
    for (const c of combos) {
      const p = planClassificationMirror(c);
      if (p.write) {
        for (const [k, v] of Object.entries(p.patch)) {
          ok(v !== null, `patch.${k} must never be null (null erases provenance)`);
          ok(v !== undefined, `patch.${k} must never be undefined`);
        }
      }
    }
  }

  if (failures > 0) {
    throw new Error(`classification-mirror-core: ${failures} failure(s)`);
  }
  return { passed };
}
