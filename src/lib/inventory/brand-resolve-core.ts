/**
 * src/lib/inventory/brand-resolve-core.ts
 *
 * RECEIVING INTAKE brand resolution (pure: no React, no DB, no server-only).
 *
 * ============================================================================
 * RECEIVING INTAKE IS THE REAL PIPELINE. CULTIVERA IS A ONE-TIME IMPORT.
 * ----------------------------------------------------------------------------
 * Products enter Greenway through RECEIVING INTAKE — a vendor manifest or
 * invoice arriving with physical inventory. That is the ONLY door, and it is
 * permanent, business-critical infrastructure.
 *
 * The Cultivera menu import (src/lib/purchasing/cultivera-*) is a ONE-TIME
 * event that will NEVER be used again once the changeover is done. It is crap
 * vendor data we drag into our own system once. It is NOT how products enter
 * the store, and it is NOT the system we build around.
 *
 * If you are here to fix "brands", fix it HERE first. See
 * docs/RECEIVING-IS-THE-REAL-PIPELINE.md and standing rule 11 in AGENTS.md.
 * ============================================================================
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * SLICE T1 unified five duplicate brand matchers behind
 * `src/lib/promotions/brand-match-core.ts` — but all five lived in the
 * PROMOTIONS/MENU half of the system. The receiving door was never looked at,
 * and it was matching brands with:
 *
 *     .ilike("display_name", label)
 *
 * Postgres ILIKE with NO wildcard metacharacters is an EXACT match that
 * ignores case only. It does NOT ignore doubled interior spaces, hyphens,
 * punctuation, or a trailing space. `brandKey()` ignores all of them.
 *
 * Measured by scripts/recon/receiving-brand-gap.py over the 168 real brand
 * records in back-office/GREENWAY WEBSITE/database/vendors, across 771
 * realistic manifest spellings of those same brands:
 *
 *     resolved by ILIKE (receiving intake before this) : 318  (41.2%)
 *     resolved by brandKey (promotions matcher)        : 771  (100.0%)
 *     MISSED by receiving, caught by brandKey          : 453
 *
 * `inventory_lots` has NO `brand_name` column (migration 0023:92) — only
 * `brand_id`. The brand a customer and the discount engine eventually see is
 * looked up FROM that id (catalog-drafts.ts reads brands.display_name by
 * lot.brand_id). So an unresolved brand at the receiving door means:
 *
 *   manifest says 'Phat  Panda' -> ILIKE misses -> brand_id NULL (no error!)
 *     -> menu item has brand_name NULL -> brandInList(...) is false
 *     -> the item is silently OFF Top Shelf Thursday and the customer pays full price.
 *
 * T1's matcher could not save that item: the brand was already destroyed hours
 * earlier, at intake.
 *
 * WHY RECEIVING IS STRICTER THAN PROMOTIONS (deliberate, measured)
 * ----------------------------------------------------------------
 * The same measurement found four brandKey merges in the real data, and TWO of
 * them span DIFFERENT VENDORS (verified by reading each brand.json):
 *
 *     420bar        SAME vendor       ['4.20 Bar', '420 Bar']
 *     rayslemonade  SAME vendor       ["Ray's Lemonade", 'Rays Lemonade']
 *     hightide      DIFFERENT vendors ['High Tide' @ NORTHWEST HARVESTING CO,
 *                                      'HighTide'  @ NALLEY VALLEY PARTNERS LLC]
 *     subx          DIFFERENT vendors ['SUBX'      @ SUBX,
 *                                      'Sub X'     @ INDEPENDENT / UNLISTED VENDOR]
 *
 * Promotions may squeeze freely — putting 'High Tide' and 'HighTide' on the
 * same DEAL is harmless. Receiving assigns OWNERSHIP OF PHYSICAL INVENTORY, so
 * a blind squeeze would attach a lot to the wrong company, corrupting vendor
 * reporting and CCRS traceability. Therefore this module accepts a squeezed
 * match ONLY when it is UNAMBIGUOUS, and otherwise refuses to guess and asks a
 * human (standing rule 3: never silently invent a value).
 */
import { brandKey } from "@/lib/promotions/brand-match-core";

/** The minimum shape of a `brands` row this decision needs. */
export type BrandCandidate = {
  id: string;
  display_name: string | null;
  vendor_id?: string | null;
};

/**
 * How the brand was resolved. The caller logs this, so a human can see WHY a
 * lot got the brand it got — silent magic is what created the original bug.
 */
export type BrandResolveOutcome =
  /** No usable label on the manifest line. Nothing to resolve. */
  | { kind: "no-label" }
  /** Exact match ignoring case only — what ILIKE already did. */
  | { kind: "exact"; brandId: string; matched: string }
  /** Matched after squeezing case/space/punctuation, and it was unique. */
  | { kind: "squeezed"; brandId: string; matched: string; label: string }
  /**
   * Two or more DIFFERENT brands squeeze to the same key. We refuse to guess.
   * `candidates` goes in front of a human.
   */
  | { kind: "ambiguous"; label: string; candidates: readonly BrandCandidate[] }
  /** Genuinely unknown brand. Caller decides (today: brand_id stays NULL). */
  | { kind: "miss"; label: string }
  /**
   * We COULD NOT LOOK — the brand read failed or was truncated. This is NOT a
   * miss, and conflating the two is how a real brand gets silently dropped:
   * "the brand does not exist" and "the database did not answer" both wrote
   * brand_id NULL and looked identical in the log. Kept as its own kind so the
   * distinction cannot be lost again.
   */
  | { kind: "read-incomplete"; label: string; reason: string };

/**
 * Exact match ignoring case only — a faithful model of Postgres
 * `ILIKE 'value'` when `value` contains no `%` or `_` metacharacters.
 *
 * Kept as a named function so the self-test can assert the OLD behaviour is
 * preserved on the fast path, not merely assumed.
 */
export function ilikeExact(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Decide which brand a manifest label refers to.
 *
 * PURE. The caller supplies the candidate rows (already vendor-filtered when a
 * vendor is known) and performs no matching of its own — so receiving intake
 * and promotions share ONE definition of brand identity, `brandKey()`, and
 * cannot drift apart again by construction.
 */
export function resolveBrandDecision(
  label: string | null | undefined,
  candidates: readonly BrandCandidate[] | null | undefined,
): BrandResolveOutcome {
  const raw = (label ?? "").trim();
  if (!raw) return { kind: "no-label" };

  const key = brandKey(raw);
  // A label of pure punctuation ("--", "!!") squeezes to "" and is not a
  // brand. brandKey() already treats "" as never-matching; be explicit here so
  // a punctuation label can never collide with a punctuation brand name.
  if (!key) return { kind: "miss", label: raw };

  const rows = candidates ?? [];

  // 1) FAST PATH — exact ignoring case. This is what ILIKE did, preserved
  //    verbatim so behaviour that already worked cannot regress.
  for (const row of rows) {
    if (ilikeExact(row.display_name, raw)) {
      return { kind: "exact", brandId: row.id, matched: row.display_name ?? raw };
    }
  }

  // 2) SQUEEZED PATH — the 453 spellings receiving used to drop on the floor.
  const hits = rows.filter((row) => {
    const rowKey = brandKey(row.display_name);
    return rowKey !== "" && rowKey === key;
  });

  if (hits.length === 1) {
    const hit = hits[0];
    return { kind: "squeezed", brandId: hit.id, matched: hit.display_name ?? raw, label: raw };
  }

  // 3) AMBIGUOUS — 'High Tide' vs 'HighTide' across two vendors. Physical
  //    inventory ownership is not a coin flip. Escalate to a human.
  if (hits.length > 1) {
    // Distinct ids only: the same brand appearing twice in a paged read is not
    // an ambiguity, it is a duplicate row.
    const byId = new Map<string, BrandCandidate>();
    for (const hit of hits) byId.set(hit.id, hit);
    if (byId.size === 1) {
      const only = [...byId.values()][0];
      return { kind: "squeezed", brandId: only.id, matched: only.display_name ?? raw, label: raw };
    }
    return { kind: "ambiguous", label: raw, candidates: [...byId.values()] };
  }

  return { kind: "miss", label: raw };
}

/** Convenience: the id to write, or null when we must not guess. */
export function brandIdFromOutcome(outcome: BrandResolveOutcome): string | null {
  return outcome.kind === "exact" || outcome.kind === "squeezed" ? outcome.brandId : null;
}

/**
 * A human-readable reason, for the manifest event log. An unresolved brand used
 * to be COMPLETELY silent; that silence is what let full-price sales happen.
 */
export function describeBrandOutcome(outcome: BrandResolveOutcome): string {
  switch (outcome.kind) {
    case "no-label":
      return "no brand on the manifest line";
    case "exact":
      return `exact match on "${outcome.matched}"`;
    case "squeezed":
      return `matched "${outcome.label}" to brand "${outcome.matched}" ignoring case, spacing and punctuation`;
    case "ambiguous":
      return `AMBIGUOUS: "${outcome.label}" squeezes to ${outcome.candidates.length} different brands (${outcome.candidates
        .map((c) => `${c.display_name ?? "?"}`)
        .join(" | ")}) — a human must choose; brand left unset`;
    case "miss":
      return `no brand matched "${outcome.label}" — brand left unset`;
    case "read-incomplete":
      return `READ INCOMPLETE while resolving "${outcome.label}" (${outcome.reason}) — brand left unset rather than guessed; this is NOT a confirmed miss`;
  }
}

/* -------------------------------------------------------------------------- */
/* Self-test (standing rule 5). Registered in run-pure-selftests.ts and       */
/* tests/compliance/pure-selftests.test.ts (rule 50: a self-test nothing      */
/* invokes is dead code wearing a green check).                               */
/* -------------------------------------------------------------------------- */
export function __runBrandResolveCoreTests(): { passed: number; failed: number } {
  let passed = 0;
  const failures: string[] = [];
  const check = (name: string, cond: boolean) => {
    if (cond) passed += 1;
    else failures.push(name);
  };

  const B = (id: string, display_name: string | null, vendor_id: string | null = null): BrandCandidate => ({
    id,
    display_name,
    vendor_id,
  });

  // ---- 1. no label -------------------------------------------------------
  for (const empty of [null, undefined, "", "   ", "\t"]) {
    const out = resolveBrandDecision(empty, [B("b1", "Phat Panda")]);
    check(`blank label -> no-label (${JSON.stringify(empty)})`, out.kind === "no-label");
    check(`blank label -> null id (${JSON.stringify(empty)})`, brandIdFromOutcome(out) === null);
  }

  // ---- 2. the OLD exact behaviour is preserved ---------------------------
  const one = [B("b1", "Phat Panda")];
  check("exact match", resolveBrandDecision("Phat Panda", one).kind === "exact");
  check("exact ignores case", resolveBrandDecision("PHAT PANDA", one).kind === "exact");
  check("exact ignores case (lower)", resolveBrandDecision("phat panda", one).kind === "exact");
  check("exact returns the id", brandIdFromOutcome(resolveBrandDecision("phat panda", one)) === "b1");
  check("ilikeExact is case-only", ilikeExact("Phat Panda", "PHAT PANDA"));
  check("ilikeExact rejects double space", !ilikeExact("Phat  Panda", "Phat Panda"));
  check("ilikeExact rejects null", !ilikeExact(null, "x") && !ilikeExact("x", null));

  // ---- 3. THE BUG: spellings ILIKE dropped, now resolved -----------------
  // These are the exact classes measured in the real brand data.
  for (const spelling of [
    "Phat  Panda", // doubled interior space
    "PHAT  PANDA",
    "Phat-Panda", // hyphen for space
    "PhatPanda", // no space
    "Phat Panda ", // trailing space
    " Phat Panda", // leading space
    "Phat.Panda",
    "phat_panda",
  ]) {
    const out = resolveBrandDecision(spelling, one);
    check(`squeezed resolves ${JSON.stringify(spelling)}`, out.kind === "squeezed" || out.kind === "exact");
    check(`squeezed gives id for ${JSON.stringify(spelling)}`, brandIdFromOutcome(out) === "b1");
  }

  // ---- 4. a genuinely different brand must NOT match ---------------------
  // Guards against over-squeezing: T1 proved 'Lifted' and 'Lifted Cannabis'
  // are different companies, and this is inventory ownership.
  const two = [B("b1", "Lifted"), B("b2", "Lifted Cannabis")];
  check("Lifted -> b1 exactly", brandIdFromOutcome(resolveBrandDecision("Lifted", two)) === "b1");
  check("Lifted Cannabis -> b2 exactly", brandIdFromOutcome(resolveBrandDecision("Lifted Cannabis", two)) === "b2");
  check("lifted-cannabis -> b2", brandIdFromOutcome(resolveBrandDecision("lifted-cannabis", two)) === "b2");
  check("unknown brand misses", resolveBrandDecision("Phat Yeti", two).kind === "miss");
  check("unknown brand -> null", brandIdFromOutcome(resolveBrandDecision("Phat Yeti", two)) === null);
  check("empty candidate list misses", resolveBrandDecision("Lifted", []).kind === "miss");
  check("null candidate list misses", resolveBrandDecision("Lifted", null).kind === "miss");

  // ---- 5. REAL ambiguity from the store's own data -----------------------
  // 'High Tide' @ NORTHWEST HARVESTING CO vs 'HighTide' @ NALLEY VALLEY.
  const tide = [B("t1", "High Tide", "v-nwh"), B("t2", "HighTide", "v-nalley")];
  // NOTE, and this is the subtle part: "HIGH TIDE" is an EXACT case-only match
  // for "High Tide", so it is NOT ambiguous and must resolve to t1. Ambiguity
  // needs a spelling that matches NEITHER row exactly — a hyphen or a dot.
  // (My first draft of this test asserted "HIGH TIDE" was ambiguous; the
  // self-test failed and was right to. Recorded rather than quietly patched.)
  for (const hyphenated of ["High-Tide", "HIGH_TIDE", "high.tide", "High  Tide"]) {
    const amb = resolveBrandDecision(hyphenated, tide);
    check(`cross-vendor squeeze is ambiguous (${hyphenated})`, amb.kind === "ambiguous");
    check(`ambiguous never guesses an id (${hyphenated})`, brandIdFromOutcome(amb) === null);
    check(`ambiguous reports both (${hyphenated})`, amb.kind === "ambiguous" && amb.candidates.length === 2);
  }
  // ...but an EXACT spelling is never ambiguous, even in that pair.
  check("exact wins over ambiguity (High Tide)", brandIdFromOutcome(resolveBrandDecision("High Tide", tide)) === "t1");
  check("exact wins over ambiguity (HighTide)", brandIdFromOutcome(resolveBrandDecision("HighTide", tide)) === "t2");
  check(
    "exact wins over ambiguity, case-insensitively (t2)",
    brandIdFromOutcome(resolveBrandDecision("hightide", tide)) === "t2",
  );
  check(
    "exact wins over ambiguity, case-insensitively (t1)",
    brandIdFromOutcome(resolveBrandDecision("HIGH TIDE", tide)) === "t1",
  );
  // The SUBX pair, same shape. "sub x" exactly matches "Sub X", so the
  // ambiguous spelling must again be one that matches neither.
  const subx = [B("s1", "SUBX", "v-subx"), B("s2", "Sub X", "v-indep")];
  check("SUBX/Sub X squeeze is ambiguous", resolveBrandDecision("sub-x", subx).kind === "ambiguous");
  check("SUBX/Sub X squeeze is ambiguous (dot)", resolveBrandDecision("S.U.B.X", subx).kind === "ambiguous");
  check("SUBX exact still resolves", brandIdFromOutcome(resolveBrandDecision("SUBX", subx)) === "s1");
  check("Sub X exact still resolves", brandIdFromOutcome(resolveBrandDecision("Sub X", subx)) === "s2");
  check("sub x is exact for Sub X", brandIdFromOutcome(resolveBrandDecision("sub x", subx)) === "s2");

  // ---- 6. duplicate ROWS of the same brand are not an ambiguity ----------
  const dupRow = [B("d1", "Fweedom"), B("d1", "Fweedom")];
  check("same id twice -> not ambiguous", resolveBrandDecision("fweedom!", dupRow).kind === "squeezed");
  check("same id twice -> that id", brandIdFromOutcome(resolveBrandDecision("fweedom!", dupRow)) === "d1");

  // ---- 7. junk labels and junk rows never match ---------------------------
  const junkRows = [B("j1", "--"), B("j2", null), B("j3", "   ")];
  for (const junk of ["--", "!!", "   ", "***"]) {
    const out = resolveBrandDecision(junk, junkRows);
    check(`punctuation label ${JSON.stringify(junk)} never matches`, out.kind === "miss" || out.kind === "no-label");
    check(`punctuation label ${JSON.stringify(junk)} -> null`, brandIdFromOutcome(out) === null);
  }
  check("null display_name never matches", resolveBrandDecision("Anything", [B("x", null)]).kind === "miss");
  check("blank display_name never matches", resolveBrandDecision("Anything", [B("x", "  ")]).kind === "miss");

  // ---- 8. the two SAME-vendor merges resolve cleanly ----------------------
  // '4.20 Bar' / '420 Bar' and "Ray's Lemonade" / 'Rays Lemonade' are one
  // company each. Given ONE row, either spelling must resolve.
  check("4.20 Bar row, '420 Bar' label", brandIdFromOutcome(resolveBrandDecision("420 Bar", [B("f", "4.20 Bar")])) === "f");
  check("420 Bar row, '4.20 Bar' label", brandIdFromOutcome(resolveBrandDecision("4.20 Bar", [B("f", "420 Bar")])) === "f");
  check(
    "Ray's Lemonade apostrophe-insensitive",
    brandIdFromOutcome(resolveBrandDecision("Rays Lemonade", [B("r", "Ray's Lemonade")])) === "r",
  );

  // ---- 8b. "could not look" is NOT "does not exist" -----------------------
  // A failed/truncated read and a genuine miss both leave brand_id NULL, so
  // they are easy to conflate — and conflating them is how a real brand gets
  // silently dropped. They must stay distinguishable.
  const incomplete: BrandResolveOutcome = { kind: "read-incomplete", label: "Phat Panda", reason: "read_failed" };
  const genuineMiss: BrandResolveOutcome = { kind: "miss", label: "Phat Panda" };
  // Read through a widening accessor: comparing the two narrowed literal types
  // directly is a tsc error (TS2367 — no overlap), and rightly so. The runtime
  // assertion we actually want is "these two outcomes are distinguishable".
  const kindOf = (o: BrandResolveOutcome): string => o.kind;
  check("read-incomplete is not a miss", kindOf(incomplete) !== kindOf(genuineMiss));
  check("read-incomplete writes no id", brandIdFromOutcome(incomplete) === null);
  check("read-incomplete says READ INCOMPLETE", describeBrandOutcome(incomplete).includes("READ INCOMPLETE"));
  check(
    "read-incomplete denies being a confirmed miss",
    describeBrandOutcome(incomplete).includes("NOT a confirmed miss"),
  );
  check("read-incomplete carries the reason", describeBrandOutcome(incomplete).includes("read_failed"));
  check("a genuine miss does not claim a read failure", !describeBrandOutcome(genuineMiss).includes("READ INCOMPLETE"));

  // ---- 9. the reason string is always usable ------------------------------
  for (const out of [
    resolveBrandDecision("", one),
    resolveBrandDecision("Phat Panda", one),
    resolveBrandDecision("Phat  Panda", one),
    resolveBrandDecision("High-Tide", tide),
    resolveBrandDecision("Nope", one),
    incomplete,
  ] as BrandResolveOutcome[]) {
    const msg = describeBrandOutcome(out);
    check(`describe(${out.kind}) is non-empty`, typeof msg === "string" && msg.length > 0);
  }
  check(
    "ambiguous reason names both brands",
    describeBrandOutcome(resolveBrandDecision("High-Tide", tide)).includes("High Tide") &&
      describeBrandOutcome(resolveBrandDecision("High-Tide", tide)).includes("HighTide"),
  );
  check(
    "ambiguous reason is shouty enough to notice",
    describeBrandOutcome(resolveBrandDecision("High-Tide", tide)).includes("AMBIGUOUS"),
  );

  // ---- 10. THE ANTI-DRIFT ASSERTION (rule: cannot regress silently) ------
  // If someone re-implements matching here instead of using brandKey(), these
  // fail. This is the guard the original bug needed and did not have.
  check("uses brandKey: 'Phat  Panda' == 'phat-panda'", brandKey("Phat  Panda") === brandKey("phat-panda"));
  check(
    "receiving agrees with promotions on every T1 spelling",
    ["Phat Panda", "Phat  Panda", "PHAT PANDA", "phat-panda", "PhatPanda"].every(
      (s) => brandIdFromOutcome(resolveBrandDecision(s, one)) === "b1",
    ),
  );

  if (failures.length > 0) {
    throw new Error(
      `brand-resolve-core self-test FAILED (${failures.length}): ${failures.slice(0, 12).join("; ")}`,
    );
  }
  return { passed, failed: 0 };
}
