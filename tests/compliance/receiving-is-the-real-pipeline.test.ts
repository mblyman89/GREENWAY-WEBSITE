/**
 * tests/compliance/receiving-is-the-real-pipeline.test.ts
 *
 * STANDING RULE 11 — RECEIVING INTAKE IS THE ONLY WAY PRODUCTS ENTER GREENWAY.
 * THE CULTIVERA MENU IMPORT IS A ONE-TIME EVENT, NEVER USED AGAIN.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * SLICE T1 unified five duplicate brand matchers behind
 * src/lib/promotions/brand-match-core.ts. Every one of the five was in the
 * PROMOTIONS/MENU half of the system — the half fed by the one-time Cultivera
 * import. The REAL door, receiving intake, was never looked at, and it still
 * matched brands with `.ilike("display_name", label)`, which ignores case ONLY.
 *
 * Measured over the store's 168 real brands / 771 realistic manifest spellings
 * (scripts/recon/receiving-brand-gap.py): ILIKE resolved 41.2%, the shared
 * matcher resolved 100%. 453 spellings were dropped silently, `brand_id` went
 * NULL with no error, the item reached the menu UNBRANDED, and it fell off
 * Top Shelf Thursday AT FULL PRICE.
 *
 * These tests fail if receiving intake and promotions ever drift apart again,
 * and they fail if anyone re-centres the product pipeline on Cultivera.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { brandKey, brandInList } from "@/lib/promotions/brand-match-core";
import {
  resolveBrandDecision,
  brandIdFromOutcome,
  describeBrandOutcome,
  ilikeExact,
  __runBrandResolveCoreTests,
  type BrandCandidate,
} from "@/lib/inventory/brand-resolve-core";
// The REAL receiving resolver. It takes the admin client as a parameter, so it
// can be executed for real against a fake PostgREST builder (see below).
import { resolveBrandId, resolveBrandIdDetailed } from "@/lib/inventory/intake-store";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const B = (id: string, display_name: string | null, vendor_id: string | null = null): BrandCandidate => ({
  id,
  display_name,
  vendor_id,
});

/**
 * A faithful-enough fake of the PostgREST chained query builder for the ONE
 * table this function reads. Modelled on the real semantics, deliberately:
 *
 *   .ilike("display_name", v)  -> EXACT match ignoring case (no wildcards in v)
 *   .eq("vendor_id", v)        -> filter
 *   .order(...).range(a, b)    -> deterministic page slice
 *
 * `queries` counts which paths were taken, so a test can prove the fast path
 * was used (or that the fallback really ran) rather than assuming it.
 */
function fakeBrandsAdmin(rows: readonly BrandCandidate[], opts: { failRanged?: boolean } = {}) {
  const queries = { ilike: 0, ranged: 0 };

  const builder = () => {
    let filtered = [...rows];
    let isIlike = false;
    let isRanged = false;
    let from = 0;
    let to = Number.MAX_SAFE_INTEGER;

    const api: Record<string, unknown> = {
      select: () => api,
      ilike: (_col: string, value: string) => {
        isIlike = true;
        queries.ilike += 1;
        filtered = filtered.filter(
          (r) => (r.display_name ?? "").toLowerCase() === String(value).toLowerCase(),
        );
        return api;
      },
      eq: (_col: string, value: string) => {
        filtered = filtered.filter((r) => (r.vendor_id ?? null) === value);
        return api;
      },
      order: () => {
        filtered = [...filtered].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        return api;
      },
      limit: (n: number) => {
        filtered = filtered.slice(0, n);
        return api;
      },
      range: (a: number, b: number) => {
        isRanged = true;
        queries.ranged += 1;
        from = a;
        to = b;
        return api;
      },
      // PostgREST builders are thenable; both call sites `await` them.
      then: (resolve: (v: { data: unknown; error: unknown }) => unknown) => {
        if (isRanged && opts.failRanged) {
          return Promise.resolve(resolve({ data: null, error: { message: "simulated read failure" } }));
        }
        const data = isRanged ? filtered.slice(from, to + 1) : filtered;
        void isIlike;
        return Promise.resolve(resolve({ data, error: null }));
      },
    };
    return api;
  };

  const admin = { from: (table: string) => {
    expect(table).toBe("brands");
    return builder();
  } };
  // The real signature is the Supabase admin client; this fake implements the
  // only surface resolveBrandId touches.
  return { admin: admin as unknown as Parameters<typeof resolveBrandId>[0], queries };
}

describe("standing rule 11 — receiving intake is the real pipeline", () => {
  it("the pure receiving brand resolver self-test passes", () => {
    const r = __runBrandResolveCoreTests();
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(60);
  });

  /* ---------------------------------------------------------------------- */
  /* THE ANTI-DRIFT GUARD. This is the test the original bug needed.        */
  /* ---------------------------------------------------------------------- */

  it("receiving intake resolves brands through the SHARED matcher, not its own copy", () => {
    const src = read("src/lib/inventory/intake-store.ts");
    // It must delegate to the pure core...
    expect(src).toContain("brand-resolve-core");
    expect(src).toContain("resolveBrandDecision");
    // ...and the pure core must delegate to the ONE brand matcher.
    const core = read("src/lib/inventory/brand-resolve-core.ts");
    expect(core).toContain('from "@/lib/promotions/brand-match-core"');
    expect(core).toContain("brandKey");
  });

  it("receiving no longer decides a brand with a bare ILIKE and nothing else", () => {
    const src = read("src/lib/inventory/intake-store.ts");
    // The fast path may still use ilike — that is the optimisation. What must
    // NOT exist is the old shape where a single limit(1) ilike was the WHOLE
    // decision, with no squeezed fallback.
    expect(src).toContain("pagedAllChecked<BrandCandidate>");
    expect(src).toContain("BRAND_SCAN_MAX_ROWS");
  });

  it("receiving and promotions agree on every spelling of one brand", () => {
    // The same list T1 pinned for the promotions surfaces.
    const spellings = ["Phat Panda", "Phat  Panda", "PHAT PANDA", "phat-panda", "PhatPanda", "Phat Panda "];
    const rows = [B("b-panda", "Phat Panda")];
    for (const s of spellings) {
      // promotions says: on the deal
      expect(brandInList(["Phat Panda"], s)).toBe(true);
      // receiving says: this is brand b-panda
      expect(brandIdFromOutcome(resolveBrandDecision(s, rows))).toBe("b-panda");
    }
  });

  it("the 453-spelling gap is closed: what ILIKE dropped, receiving now resolves", () => {
    const rows = [B("b1", "Agro Couture")];
    const dropped = ["Agro  Couture", "Agro-Couture", "AgroCouture", "Agro Couture ", "AGRO  COUTURE"];
    for (const spelling of dropped) {
      // Proof the OLD code missed it...
      expect(ilikeExact(spelling, "Agro Couture")).toBe(false);
      // ...and the NEW code resolves it.
      expect(brandIdFromOutcome(resolveBrandDecision(spelling, rows))).toBe("b1");
    }
  });

  it("a resolved brand is what puts an item on a brand deal (the full failure chain)", () => {
    // This is the money assertion. Model the real chain:
    //   manifest label -> resolveBrandId -> brand_id -> brands.display_name
    //   -> menu item brand -> brandInList(thursday brands)
    const brands = [B("b-panda", "Phat Panda")];
    const thursday = ["Phat Panda", "Lifted"];

    const receive = (manifestLabel: string): boolean => {
      const outcome = resolveBrandDecision(manifestLabel, brands);
      const brandId = brandIdFromOutcome(outcome);
      // inventory_lots has NO brand_name column: the menu brand comes from the id.
      const displayName = brandId ? (brands.find((b) => b.id === brandId)?.display_name ?? null) : null;
      return brandInList(thursday, displayName);
    };

    // The vendor's doubled-space spelling used to break this chain at step 2.
    expect(receive("Phat  Panda")).toBe(true);
    expect(receive("phat-panda")).toBe(true);
    expect(receive("Phat Panda")).toBe(true);
    // A brand genuinely not on the deal still is not on the deal.
    expect(receive("Phat Yeti")).toBe(false);

    // And prove the OLD behaviour really did break it, so this is not theatre.
    const receiveOldWay = (manifestLabel: string): boolean => {
      const hit = brands.find((b) => ilikeExact(b.display_name, manifestLabel));
      return brandInList(thursday, hit?.display_name ?? null);
    };
    expect(receiveOldWay("Phat  Panda")).toBe(false); // <- the full-price bug
    expect(receiveOldWay("Phat Panda")).toBe(true);
  });

  /* ---------------------------------------------------------------------- */
  /* RECEIVING IS STRICTER THAN PROMOTIONS — proven from the real data.     */
  /* ---------------------------------------------------------------------- */

  it("refuses to guess when one squeezed key spans two different vendors", () => {
    // Verified in back-office/GREENWAY WEBSITE/database/vendors:
    //   'High Tide' @ NORTHWEST HARVESTING CO, 'HighTide' @ NALLEY VALLEY.
    const tide = [B("t1", "High Tide", "v-nwh"), B("t2", "HighTide", "v-nalley")];
    // The ambiguous spelling must match NEITHER row exactly. "HIGH TIDE" is an
    // exact case-only match for "High Tide", so it correctly resolves to t1;
    // a hyphen/dot spelling is the one that squeezes onto both.
    const out = resolveBrandDecision("High-Tide", tide);
    expect(out.kind).toBe("ambiguous");
    expect(brandIdFromOutcome(out)).toBeNull();
    expect(describeBrandOutcome(out)).toContain("AMBIGUOUS");

    // Promotions, by contrast, MAY squeeze: same deal is harmless.
    expect(brandKey("High Tide")).toBe(brandKey("HighTide"));

    // An exact spelling is never ambiguous — case included.
    expect(brandIdFromOutcome(resolveBrandDecision("High Tide", tide))).toBe("t1");
    expect(brandIdFromOutcome(resolveBrandDecision("HIGH TIDE", tide))).toBe("t1");
    expect(brandIdFromOutcome(resolveBrandDecision("HighTide", tide))).toBe("t2");
    expect(brandIdFromOutcome(resolveBrandDecision("hightide", tide))).toBe("t2");
  });

  it("never attaches physical inventory to the wrong company", () => {
    const subx = [B("s1", "SUBX", "v-subx"), B("s2", "Sub X", "v-indep")];
    // Ambiguous -> nobody gets the lot until a human decides. ("sub x" is an
    // exact case-only match for "Sub X", so it is NOT the ambiguous case.)
    expect(brandIdFromOutcome(resolveBrandDecision("SUB-X", subx))).toBeNull();
    expect(brandIdFromOutcome(resolveBrandDecision("s.u.b.x", subx))).toBeNull();
    // Exact spellings are unaffected.
    expect(brandIdFromOutcome(resolveBrandDecision("SUBX", subx))).toBe("s1");
    expect(brandIdFromOutcome(resolveBrandDecision("Sub X", subx))).toBe("s2");
    expect(brandIdFromOutcome(resolveBrandDecision("sub x", subx))).toBe("s2");
  });

  /* ---------------------------------------------------------------------- */
  /* EXECUTING WIRING TESTS. Source-text assertions proved insufficient:    */
  /* the R11 mutation harness reverted intake-store to the bare ILIKE       */
  /* resolver and the suite stayed GREEN, because nothing CALLED the real   */
  /* function. `resolveBrandId` takes the admin client as a PARAMETER, so a */
  /* fake PostgREST client lets us run the real code path for real.         */
  /* ---------------------------------------------------------------------- */

  it("the REAL resolveBrandId resolves a doubled-space manifest brand", async () => {
    const { admin, queries } = fakeBrandsAdmin([B("b-panda", "Phat Panda", "v1")]);
    const id = await resolveBrandId(admin, "Phat  Panda", null);
    // The bare-ILIKE resolver returns null here. That is the bug.
    expect(id).toBe("b-panda");
    // and it really did have to fall through past the exact query
    expect(queries.ilike).toBeGreaterThan(0);
    expect(queries.ranged).toBeGreaterThan(0);
  });

  it("the REAL resolveBrandId still takes the fast exact path when it can", async () => {
    const { admin, queries } = fakeBrandsAdmin([B("b-panda", "Phat Panda", "v1")]);
    expect(await resolveBrandId(admin, "Phat Panda", null)).toBe("b-panda");
    // No paged scan needed: the exact match short-circuits. This keeps the
    // common case at exactly the cost it always had.
    expect(queries.ranged).toBe(0);
  });

  it("the REAL resolveBrandId refuses to guess across two vendors", async () => {
    const { admin } = fakeBrandsAdmin([B("t1", "High Tide", "v-nwh"), B("t2", "HighTide", "v-nalley")]);
    expect(await resolveBrandId(admin, "High-Tide", null)).toBeNull();
    // exact spellings unaffected
    expect(await resolveBrandId(admin, "High Tide", null)).toBe("t1");
    expect(await resolveBrandId(admin, "HighTide", null)).toBe("t2");
  });

  it("the REAL resolveBrandId reports WHY, not just null", async () => {
    const { admin } = fakeBrandsAdmin([B("t1", "High Tide", "v-nwh"), B("t2", "HighTide", "v-nalley")]);
    const amb = await resolveBrandIdDetailed(admin, "High-Tide", null);
    expect(amb.brandId).toBeNull();
    expect(amb.outcome.kind).toBe("ambiguous");

    const hit = await resolveBrandIdDetailed(admin, "HIGH  TIDE", null);
    // 'HIGH  TIDE' squeezes onto both -> still ambiguous, still no guess.
    expect(hit.brandId).toBeNull();

    const miss = await resolveBrandIdDetailed(admin, "Nobody", null);
    expect(miss.outcome.kind).toBe("miss");
  });

  it("a FAILED brand read is never reported as a confident miss", async () => {
    // If the paged scan errors, writing brand_id NULL would look identical to
    // "this brand does not exist" — and that is how a real brand gets dropped.
    const { admin } = fakeBrandsAdmin([B("b-panda", "Phat Panda", "v1")], { failRanged: true });
    const res = await resolveBrandIdDetailed(admin, "Phat  Panda", null);
    expect(res.brandId).toBeNull();
    // "could not look" must NOT be reported as "does not exist".
    expect(res.outcome.kind).toBe("read-incomplete");
    expect(res.outcome.kind).not.toBe("miss");
    expect(describeBrandOutcome(res.outcome)).toContain("READ INCOMPLETE");
    expect(describeBrandOutcome(res.outcome)).toContain("NOT a confirmed miss");
    expect(brandIdFromOutcome(res.outcome)).toBeNull();

    // ...and a GENUINE miss on a healthy read is still reported as a miss, so
    // the two remain distinguishable in the log.
    const { admin: ok } = fakeBrandsAdmin([B("b-panda", "Phat Panda", "v1")]);
    const real = await resolveBrandIdDetailed(ok, "Nobody At All", null);
    expect(real.outcome.kind).toBe("miss");
  });

  it("the vendor filter is applied when a vendor is known", async () => {
    // Same squeezed key, but scoped to one vendor -> unambiguous again.
    const rows = [B("t1", "High Tide", "v-nwh"), B("t2", "HighTide", "v-nalley")];
    const { admin } = fakeBrandsAdmin(rows);
    expect(await resolveBrandId(admin, "High-Tide", "v-nalley")).toBe("t2");
    expect(await resolveBrandId(admin, "High-Tide", "v-nwh")).toBe("t1");
  });

  it("an unresolved brand is never silent", () => {
    const rows = [B("b1", "Phat Panda")];
    expect(describeBrandOutcome(resolveBrandDecision("Nope", rows))).toContain("no brand matched");
    expect(describeBrandOutcome(resolveBrandDecision("", rows))).toContain("no brand");
    // and it never invents an id
    expect(brandIdFromOutcome(resolveBrandDecision("Nope", rows))).toBeNull();
  });

  /* ---------------------------------------------------------------------- */
  /* THE RULE IS WRITTEN DOWN, REDUNDANTLY (owner's explicit instruction).  */
  /* ---------------------------------------------------------------------- */

  it("standing rule 11 is in AGENTS.md and says Cultivera is one-time", () => {
    const agents = read("AGENTS.md");
    expect(agents).toContain("RECEIVING INTAKE IS THE ONLY WAY PRODUCTS ENTER GREENWAY");
    expect(agents).toContain("ONE-TIME EVENT THAT WILL NEVER BE USED AGAIN");
    expect(agents).toMatch(/^11\. /m);
  });

  it("the living reference document exists and states the fix order", () => {
    const doc = read("docs/RECEIVING-IS-THE-REAL-PIPELINE.md");
    expect(doc).toContain("RECEIVING INTAKE IS THE ONLY WAY PRODUCTS ENTER GREENWAY");
    expect(doc).toContain("one-time");
    // the measured evidence must stay in the document
    expect(doc).toContain("41.2%");
    expect(doc).toContain("453");
  });

  it("every Cultivera entry point is labelled ONE-TIME at the point of use", () => {
    for (const rel of [
      "src/lib/purchasing/cultivera-menu-core.ts",
      "src/lib/purchasing/cultivera-store.ts",
      "src/lib/purchasing/cultivera-client.ts",
    ]) {
      const src = read(rel);
      expect(src, rel).toContain("ONE-TIME IMPORT ONLY");
      expect(src, rel).toContain("NOT HOW PRODUCTS ENTER GREENWAY");
      expect(src, rel).toContain("RECEIVING INTAKE");
    }
  });

  it("the receiving door and the migration importer both say which one is real", () => {
    const intake = read("src/lib/inventory/intake-store.ts");
    expect(intake).toContain("THIS IS THE REAL PIPELINE");
    expect(intake).toContain("ONE-TIME");

    const importer = read("src/lib/pos/import-service.ts");
    expect(importer).toContain("NOT THE PRODUCT PIPELINE");
    expect(importer).toContain("RECEIVING INTAKE");

    const core = read("src/lib/inventory/brand-resolve-core.ts");
    expect(core).toContain("RECEIVING INTAKE IS THE REAL PIPELINE");
    expect(core).toContain("ONE-TIME");
  });
});
